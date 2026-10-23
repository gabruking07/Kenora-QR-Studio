import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import MediaShare from '../src/models/MediaShare.js';

process.env.JWT_SECRET = 'media-tests-use-a-local-secret-only-32-chars';
const { default: app } = await import('../src/app.js');
const { cloudinaryCaps } = await import('../src/utils/cloudinary.js');
const userToken = jwt.sign({ id: '66b000000000000000000001', email: 'test@example.com' }, process.env.JWT_SECRET);
const originalCloudinary = {
  name: process.env.CLOUDINARY_CLOUD_NAME,
  key: process.env.CLOUDINARY_API_KEY,
  secret: process.env.CLOUDINARY_API_SECRET
};

before(() => {
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
});

after(() => {
  if (originalCloudinary.name) process.env.CLOUDINARY_CLOUD_NAME = originalCloudinary.name;
  if (originalCloudinary.key) process.env.CLOUDINARY_API_KEY = originalCloudinary.key;
  if (originalCloudinary.secret) process.env.CLOUDINARY_API_SECRET = originalCloudinary.secret;
});

test('health endpoint remains available', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
});

test('private media operations require the existing JWT identity', async () => {
  const response = await request(app).get('/api/media/shares');
  assert.equal(response.status, 401);
});

test('missing Cloudinary configuration returns an actionable service error', async () => {
  const response = await request(app).post('/api/media/shares').set('Authorization', `Bearer ${userToken}`).send({ title: 'Trip photos', password: 'local-test-pass', expiry: '24h' });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /CLOUDINARY_CLOUD_NAME/);
});

test('upload policy never exceeds Cloudinary Free per-file size ceilings', () => {
  assert.equal(cloudinaryCaps.imageBytes, 10 * 1024 * 1024);
  assert.equal(cloudinaryCaps.videoBytes, 100 * 1024 * 1024);
});

test('a user cannot access another owner’s media share', async t => {
  t.mock.method(MediaShare, 'findById', async () => null);
  const response = await request(app).get('/api/media/shares/66b000000000000000000099').set('Authorization', `Bearer ${userToken}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.message, 'Share not found');
});

test('incorrect album passwords do not issue access grants', async t => {
  const share = { _id: '66b000000000000000000002', token: 'sample-private-token', status: 'active', expiresAt: new Date(Date.now() + 60000) };
  t.mock.method(MediaShare, 'findOne', async () => share);
  t.mock.method(MediaShare, 'findById', () => ({ select: async () => ({ ...share, passwordHash: 'hashed-password' }) }));
  t.mock.method(bcrypt, 'compare', async () => false);
  const response = await request(app).post('/api/media/public/sample-private-token/verify-password').send({ password: 'wrong-password' });
  assert.equal(response.status, 401);
  assert.equal(response.body.data, undefined);
});

test('expired shares reject public access before requiring a grant', async t => {
  t.mock.method(MediaShare, 'findOne', async () => ({ _id: '66b000000000000000000003', token: 'expired-token', status: 'expired', expiresAt: new Date(Date.now() - 1000) }));
  const response = await request(app).get('/api/media/public/expired-token');
  assert.equal(response.status, 410);
});
