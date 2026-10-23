import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { z } from 'zod';
import MediaShare from '../models/MediaShare.js';
import MediaFile from '../models/MediaFile.js';
import { cloudinaryCaps, cloudinaryClient, mediaLimits, privateDownloadUrl, tokenForAsset } from '../utils/cloudinary.js';

const expiries = { '1h': 1, '6h': 6, '24h': 24, '3d': 72, '7d': 168 };
const shareSchema = z.object({ title: z.string().trim().min(2).max(100), description: z.string().trim().max(1000).optional().default(''), password: z.string().min(8).max(100), expiry: z.enum(['1h', '6h', '24h', '3d', '7d']) });
const cleanName = value => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'file';
const currentStatus = share => share.status === 'active' && share.expiresAt <= new Date() ? 'expired' : share.status;
const shareJson = share => ({ id: share._id, token: share.token, title: share.title, description: share.description, status: currentStatus(share), retention: share.retention, expiresAt: share.expiresAt, createdAt: share.createdAt, fileCount: share.fileCount, totalBytes: share.totalBytes, reservedBytes: share.reservedBytes });

function safeShare(share, ownerId) {
  if (!share) return null;
  if (String(share.ownerId) !== String(ownerId)) return null;
  if (currentStatus(share) === 'expired' && share.status === 'active') share.updateOne({ status: 'expired' }).catch(() => {});
  return share;
}

function accessGrant(token, share) {
  const grant = jwt.sign({ purpose: 'media-access', share: String(share._id), token }, process.env.JWT_SECRET, { expiresIn: '15m' });
  return grant;
}

async function requireGrant(req, share) {
  const header = req.headers.authorization || '';
  const grant = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    const payload = jwt.verify(grant, process.env.JWT_SECRET);
    if (payload.purpose !== 'media-access' || payload.share !== String(share._id) || payload.token !== share.token) throw Error();
  } catch {
    const error = new Error('Enter the album password to continue.'); error.status = 401; throw error;
  }
  const status = currentStatus(share);
  if (status !== 'active') { const error = new Error(status === 'expired' ? 'This share has expired.' : 'This share is unavailable.'); error.status = 410; throw error; }
}

async function openAsset(publicId, resourceType, range) {
  const url = tokenForAsset(publicId, resourceType);
  const response = await fetch(url, { headers: range ? { Range: range } : {} });
  if (!response.ok || !response.body) throw new Error('Media provider could not deliver this file.');
  return response;
}

export async function createShare(req, res, next) {
  try {
    cloudinaryClient();
    const body = shareSchema.parse(req.body);
    const share = await MediaShare.create({ ownerId: req.user.id, token: randomBytes(32).toString('base64url'), title: body.title, description: body.description, passwordHash: await bcrypt.hash(body.password, 12), expiresAt: new Date(Date.now() + expiries[body.expiry] * 3600000) });
    res.status(201).json({ success: true, data: { share: shareJson(share) } });
  } catch (error) { if (error instanceof z.ZodError) error.status = 400; next(error); }
}

export async function listShares(req, res, next) {
  try {
    const shares = await MediaShare.find({ ownerId: req.user.id }).sort({ createdAt: -1 }).limit(200);
    for (const s of shares) if (currentStatus(s) === 'expired' && s.status === 'active') { s.status = 'expired'; await s.save(); }
    res.json({ success: true, data: { shares: shares.map(shareJson) } });
  } catch (error) { next(error); }
}

export async function getShare(req, res, next) {
  try {
    const share = safeShare(await MediaShare.findById(req.params.id), req.user.id);
    if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
    const files = await MediaFile.find({ shareId: share._id, status: 'uploaded' }).select('originalName mimeType format sizeBytes resourceType createdAt');
    res.json({ success: true, data: { share: shareJson(share), files } });
  } catch (error) { next(error); }
}

export async function updateShare(req, res, next) {
  try {
    const input = z.object({ title: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(1000).optional(), password: z.string().min(8).max(100).optional(), expiry: z.enum(['1h', '6h', '24h', '3d', '7d']).optional() }).strict().parse(req.body);
    const share = safeShare(await MediaShare.findOne({ _id: req.params.id, ownerId: req.user.id }).select('+passwordHash'), req.user.id);
    if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
    if (input.title) share.title = input.title;
    if (input.description !== undefined) share.description = input.description;
    if (input.password) share.passwordHash = await bcrypt.hash(input.password, 12);
    if (input.expiry && currentStatus(share) === 'active') share.expiresAt = new Date(Date.now() + expiries[input.expiry] * 3600000);
    await share.save();
    res.json({ success: true, data: { share: shareJson(share) } });
  } catch (error) { if (error instanceof z.ZodError) error.status = 400; next(error); }
}

export async function revokeShare(req, res, next) {
  try {
    const share = await MediaShare.findOneAndUpdate({ _id: req.params.id, ownerId: req.user.id, status: 'active' }, { status: 'revoked' }, { new: true });
    if (!share) return res.status(404).json({ success: false, message: 'Active share not found' });
    res.json({ success: true, data: { share: shareJson(share) } });
  } catch (error) { next(error); }
}

export async function initiateUpload(req, res, next) {
  try {
    const cloudinary = cloudinaryClient();
    const { fileName, resourceType, sizeBytes, mimeType } = z.object({ fileName: z.string().min(1).max(255), resourceType: z.enum(['image', 'video']), sizeBytes: z.number().int().positive(), mimeType: z.string().max(100).optional().default('') }).strict().parse(req.body);
    const share = await MediaShare.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
    if (currentStatus(share) !== 'active') return res.status(409).json({ success: false, message: 'This share is no longer accepting uploads.' });
    const ext = fileName.split('.').pop().toLowerCase();
    const imageTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif' };
    const videoTypes = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
    const allow = resourceType === 'image' ? imageTypes : videoTypes;
    if (!allow[ext] || (mimeType && mimeType.toLowerCase() !== allow[ext])) return res.status(400).json({ success: false, message: 'Unsupported media format. Choose a supported photo or video file.' });
    const fileCap = resourceType === 'image' ? cloudinaryCaps.imageBytes : cloudinaryCaps.videoBytes;
    if (sizeBytes > fileCap) return res.status(413).json({ success: false, message: `This ${resourceType} exceeds Cloudinary Free's ${Math.floor(fileCap / 1048576)} MB per-file limit. Choose a smaller file.` });
    const reservation = await MediaShare.findOneAndUpdate({ _id: share._id, status: 'active', $expr: { $and: [{ $lt: [{ $add: ['$fileCount', '$reservedCount'] }, mediaLimits.files] }, { $lte: [{ $add: ['$totalBytes', '$reservedBytes', sizeBytes] }, mediaLimits.shareBytes] }, { $lt: ['$reservedCount', mediaLimits.concurrentUploads] }] } }, { $inc: { reservedCount: 1, reservedBytes: sizeBytes } }, { new: true });
    if (!reservation) return res.status(409).json({ success: false, message: 'Share upload limit reached: maximum 100 files, 3 simultaneous uploads, and 2 GB per share.' });
    const id = randomUUID(); const publicId = `kenora/${share.token}/${id}`; const timestamp = Math.floor(Date.now() / 1000);
    const params = { timestamp, public_id: publicId, type: 'authenticated', overwrite: false, allowed_formats: Object.keys(allow).join(',') };
    const uploadId = new (await import('../models/MediaFile.js')).default({ shareId: share._id, ownerId: req.user.id, publicToken: randomBytes(24).toString('base64url'), cloudinaryPublicId: publicId, resourceType, originalName: cleanName(fileName), mimeType: allow[ext], format: ext, sizeBytes, status: 'pending', uploadExpiresAt: new Date(Date.now() + mediaLimits.pendingMinutes * 60000) });
    try { await uploadId.save(); } catch (error) { await MediaShare.updateOne({ _id: share._id }, { $inc: { reservedCount: -1, reservedBytes: -sizeBytes } }); throw error; }
    res.status(201).json({ success: true, data: { uploadId: uploadId._id, cloudinary: { cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, timestamp, signature: cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET), publicId, type: 'authenticated', overwrite: false, allowedFormats: params.allowed_formats, resourceType } } });
  } catch (error) { if (error instanceof z.ZodError) error.status = 400; next(error); }
}

const validFormats = { image: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif']), video: new Set(['mp4', 'mov', 'm4v', 'webm']) };
const verifiedMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
export async function completeUpload(req, res, next) {
  try {
    const cloudinary = cloudinaryClient();
    const file = await MediaFile.findOne({ _id: req.params.uploadId, shareId: req.params.id, ownerId: req.user.id, status: 'pending' }).select('+cloudinaryPublicId');
    if (!file) {
      const completed = await MediaFile.findOne({ _id: req.params.uploadId, shareId: req.params.id, ownerId: req.user.id, status: 'uploaded' });
      if (completed) return res.json({ success: true, message: 'Upload already verified' });
      return res.status(404).json({ success: false, message: 'Pending upload not found' });
    }
    if (file.uploadExpiresAt < new Date()) return res.status(410).json({ success: false, message: 'Upload authorization expired. Start the upload again.' });
    const asset = await cloudinary.api.resource(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated' });
    const format = String(asset.format || '').toLowerCase();
    const cap = file.resourceType === 'image' ? cloudinaryCaps.imageBytes : cloudinaryCaps.videoBytes;
    if (!validFormats[file.resourceType].has(format) || asset.bytes !== file.sizeBytes || asset.bytes > cap) {
      let removed = false;
      try { const result = await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated', invalidate: true }); removed = result.result === 'ok' || result.result === 'not found'; } catch {}
      await releaseReservation(file, removed);
      return res.status(400).json({ success: false, message: 'Uploaded media failed server verification and was rejected.' });
    }
    const share = await MediaShare.findOne({ _id: file.shareId, ownerId: req.user.id, status: 'active', expiresAt: { $gt: new Date() } });
    if (!share) { let removed = false; try { const result = await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated' }); removed = result.result === 'ok' || result.result === 'not found'; } catch {} await releaseReservation(file, removed); return res.status(410).json({ success: false, message: 'Share expired during upload.' }); }
    const updated = await MediaFile.updateOne({ _id: file._id, status: 'pending' }, { status: 'uploaded', format, mimeType: verifiedMime[format], sizeBytes: asset.bytes });
    if (updated.modifiedCount) await MediaShare.updateOne({ _id: share._id }, { $inc: { reservedCount: -1, reservedBytes: -file.sizeBytes, fileCount: 1, totalBytes: asset.bytes } });
    else if (!await MediaFile.exists({ _id: file._id, status: 'uploaded' })) return res.status(409).json({ success: false, message: 'Upload was cancelled before verification completed.' });
    res.json({ success: true, message: 'Upload verified' });
  } catch (error) { next(error); }
}

export async function cancelUpload(req, res, next) {
  try {
    const file = await MediaFile.findOne({ _id: req.params.uploadId, shareId: req.params.id, ownerId: req.user.id, status: 'pending' }).select('+cloudinaryPublicId');
    if (!file) return res.json({ success: true, message: 'Upload reservation already released.' });
    const cloudinary = cloudinaryClient();
    try {
      const result = await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated', invalidate: true });
      await releaseReservation(file, result.result === 'ok' || result.result === 'not found');
    } catch { await releaseReservation(file, false); const error = new Error('Cancellation is queued for cleanup; retry if it remains in progress.'); error.status = 502; throw error; }
    res.json({ success: true, message: 'Upload cancelled.' });
  } catch (error) { next(error); }
}

export async function runMediaCleanup(req, res, next) {
  try {
    const cloudinary = cloudinaryClient();
    const now = new Date();
    await MediaShare.updateMany({ status: 'active', expiresAt: { $lte: now } }, { status: 'expired' });
    const pending = await MediaFile.find({ status: 'pending', uploadExpiresAt: { $lte: now } }).limit(100).select('+cloudinaryPublicId');
    const failedDeletes = await MediaFile.find({ status: 'delete_failed', uploadExpiresAt: { $lte: now } }).limit(100).select('+cloudinaryPublicId');
    let cleaned = 0; let pendingFailures = 0;
    for (const file of pending) {
      try {
        await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated', invalidate: true });
        await releaseReservation(file, true); cleaned++;
      } catch { pendingFailures++; }
    }
    for (const file of failedDeletes) {
      try {
        await cloudinary.uploader.destroy(file.cloudinaryPublicId, { resource_type: file.resourceType, type: 'authenticated', invalidate: true });
        await MediaFile.deleteOne({ _id: file._id, status: 'delete_failed' }); cleaned++;
      } catch { pendingFailures++; }
    }
    const deleting = await MediaShare.find({ status: 'deleting' }).limit(20);
    let deletionFailures = 0;
    for (const share of deleting) { try { await deleteShareAssets(share); } catch { deletionFailures++; } }
    res.json({ success: true, data: { expiredSharesMarked: true, staleUploadsCleaned: cleaned, pendingCleanupFailures: pendingFailures, deletionRetries: deleting.length, deletionFailures } });
  } catch (error) { next(error); }
}

async function releaseReservation(file, deleted = false) {
  if (deleted) {
    const result = await MediaFile.deleteOne({ _id: file._id, status: 'pending' });
    if (result.deletedCount) await MediaShare.updateOne({ _id: file.shareId }, { $inc: { reservedCount: -1, reservedBytes: -file.sizeBytes } });
  } else {
    const result = await MediaFile.updateOne({ _id: file._id, status: 'pending' }, { status: 'delete_failed' });
    if (result.modifiedCount) await MediaShare.updateOne({ _id: file.shareId }, { $inc: { reservedCount: -1, reservedBytes: -file.sizeBytes } });
  }
}

async function publicShareOrError(token) {
  const share = await MediaShare.findOne({ token });
  if (!share) { const e = new Error('Share not found'); e.status = 404; throw e; }
  const status = currentStatus(share);
  if (status !== 'active') { if (status === 'expired' && share.status === 'active') await MediaShare.updateOne({ _id: share._id, status: 'active' }, { status: 'expired' }); const e = new Error(status === 'expired' ? 'This share has expired.' : 'This share is unavailable.'); e.status = 410; throw e; }
  return share;
}

export async function verifyPassword(req, res, next) {
  try {
    const { password } = z.object({ password: z.string().min(1).max(100) }).parse(req.body);
    const share = await publicShareOrError(req.params.token);
    const privateShare = await MediaShare.findById(share._id).select('+passwordHash');
    if (!await bcrypt.compare(password, privateShare.passwordHash)) return res.status(401).json({ success: false, message: 'Incorrect album password.' });
    res.json({ success: true, data: { grant: accessGrant(share.token, share), expiresIn: 900 } });
  } catch (error) { if (error instanceof z.ZodError) error.status = 400; next(error); }
}

export async function publicAlbum(req, res, next) {
  try {
    const share = await publicShareOrError(req.params.token); await requireGrant(req, share);
    const files = await MediaFile.find({ shareId: share._id, status: 'uploaded' }).select('publicToken originalName mimeType format sizeBytes resourceType createdAt +publicToken');
    res.set('Cache-Control', 'no-store').json({ success: true, data: { title: share.title, description: share.description, files: files.map(f => ({ id: f.publicToken, originalName: f.originalName, mimeType: f.mimeType, format: f.format, sizeBytes: f.sizeBytes, resourceType: f.resourceType })) } });
  } catch (error) { next(error); }
}

export async function fileAccess(req, res, next) {
  try {
    const share = await publicShareOrError(req.params.token); await requireGrant(req, share);
    const file = await MediaFile.findOne({ publicToken: req.params.fileId, shareId: share._id, status: 'uploaded' }).select('+cloudinaryPublicId');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    const lifeSeconds = Math.max(1, Math.min(900, Math.floor((share.expiresAt.getTime() - Date.now()) / 1000)));
    const url = privateDownloadUrl(file.cloudinaryPublicId, file.format, file.resourceType, Math.floor(Date.now() / 1000) + lifeSeconds, req.query.download === '1', cleanName(file.originalName));
    res.set('Cache-Control', 'no-store').json({ success: true, data: { url, expiresIn: lifeSeconds } });
  } catch (error) { next(error); }
}

export async function streamFile(req, res, next) {
  try {
    const share = await publicShareOrError(req.params.token); await requireGrant(req, share);
    const file = await MediaFile.findOne({ publicToken: req.params.fileId, shareId: share._id, status: 'uploaded' }).select('+cloudinaryPublicId');
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    const upstream = await openAsset(file.cloudinaryPublicId, file.resourceType, req.headers.range);
    res.status(upstream.status).set('Content-Type', file.mimeType).set('Accept-Ranges', 'bytes').set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, no-store').set('Referrer-Policy', 'no-referrer');
    if (upstream.headers.get('content-length')) res.set('Content-Length', upstream.headers.get('content-length'));
    if (upstream.headers.get('content-range')) res.set('Content-Range', upstream.headers.get('content-range'));
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="${cleanName(file.originalName)}"`);
    Readable.fromWeb(upstream.body).on('error', next).pipe(res);
  } catch (error) { next(error); }
}

export async function downloadTicket(req, res, next) {
  try {
    const share = await publicShareOrError(req.params.token); await requireGrant(req, share);
    const ticket = jwt.sign({ purpose: 'media-download', share: String(share._id), token: share.token }, process.env.JWT_SECRET, { expiresIn: '60s' });
    res.set('Cache-Control', 'no-store').json({ success: true, data: { url: `${req.baseUrl}/public/${share.token}/download-all?ticket=${encodeURIComponent(ticket)}`, expiresIn: 60 } });
  } catch (error) { next(error); }
}

export async function downloadAll(req, res, next) {
  try {
    const share = await publicShareOrError(req.params.token);
    try { const ticket = jwt.verify(req.query.ticket, process.env.JWT_SECRET); if (ticket.purpose !== 'media-download' || ticket.share !== String(share._id) || ticket.token !== share.token) throw Error(); }
    catch { const error = new Error('Request a fresh album download link.'); error.status = 401; throw error; }
    const files = await MediaFile.find({ shareId: share._id, status: 'uploaded' }).select('+cloudinaryPublicId');
    if (!files.length) return res.status(404).json({ success: false, message: 'There are no files to download.' });
    res.set('Content-Type', 'application/zip').set('Content-Disposition', `attachment; filename="${cleanName(share.title)}.zip"`).set('Cache-Control', 'private, no-store');
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('error', next); archive.pipe(res);
    for (const file of files) {
      const upstream = await openAsset(file.cloudinaryPublicId, file.resourceType);
      archive.append(Readable.fromWeb(upstream.body), { name: `${String(files.indexOf(file) + 1).padStart(3, '0')}-${cleanName(file.originalName)}` });
    }
    await archive.finalize();
  } catch (error) { next(error); }
}

export async function retention(req, res, next) {
  try {
    const action = z.object({ action: z.enum(['keep', 'delete']) }).parse(req.body).action;
    const share = await MediaShare.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
    if (currentStatus(share) !== 'expired' && share.status !== 'revoked') return res.status(409).json({ success: false, message: 'Retention decisions are available after expiry or revocation.' });
    if (action === 'keep') { share.retention = 'keep'; await share.save(); return res.json({ success: true, message: 'Files will be retained in Cloudinary.', data: { share: shareJson(share) } }); }
    await deleteShareAssets(share); res.json({ success: true, message: 'All album files were permanently deleted.', data: { shareId: String(share._id), deleted: true } });
  } catch (error) { if (error instanceof z.ZodError) error.status = 400; next(error); }
}

async function deleteShareAssets(share) {
  const files = await MediaFile.find({ shareId: share._id, status: { $in: ['uploaded', 'delete_failed', 'pending'] } }).select('+cloudinaryPublicId');
  const cloudinary = files.length ? cloudinaryClient() : null;
  share = await MediaShare.findOneAndUpdate({ _id: share._id, status: { $in: ['active', 'expired', 'revoked', 'deleting'] } }, { status: 'deleting', retention: 'delete' }, { new: true });
  if (!share) { const error = new Error('Share is already unavailable. Refresh your share list.'); error.status = 409; throw error; }
  if (share.reservedCount > 0) { const error = new Error('Uploads are still in progress. Cancel them or wait for cleanup, then retry deletion.'); error.status = 409; throw error; }
  let failures = [];
  for (const type of ['image', 'video']) {
    const batch = files.filter(f => f.resourceType === type);
    if (!batch.length) continue;
    try {
      const result = await cloudinary.api.delete_resources(batch.map(f => f.cloudinaryPublicId), { resource_type: type, type: 'authenticated', invalidate: true });
      for (const file of batch) {
        const status = result.deleted?.[file.cloudinaryPublicId];
        if (status === 'deleted' || status === 'not_found') await MediaFile.deleteOne({ _id: file._id });
        else { file.status = 'delete_failed'; await file.save(); failures.push(file.originalName); }
      }
    } catch { failures.push(...batch.map(f => f.originalName)); await MediaFile.updateMany({ _id: { $in: batch.map(f => f._id) } }, { status: 'delete_failed' }); }
  }
  if (failures.length) { const error = new Error(`Some files could not be deleted (${failures.length}). Retry the delete action.`); error.status = 502; throw error; }
  await MediaShare.deleteOne({ _id: share._id });
}

export async function deleteShare(req, res, next) {
  try {
    const share = await MediaShare.findOne({ _id: req.params.id, ownerId: req.user.id });
    if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
    await deleteShareAssets(share); res.json({ success: true, message: 'Share and its files were permanently deleted.' });
  } catch (error) { next(error); }
}
