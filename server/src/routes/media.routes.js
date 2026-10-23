import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { auth } from '../middleware/auth.js';
import { createShare, listShares, getShare, updateShare, deleteShare, revokeShare, initiateUpload, completeUpload, cancelUpload, verifyPassword, publicAlbum, fileAccess, streamFile, downloadTicket, downloadAll, retention, runMediaCleanup } from '../controllers/media.controller.js';

const router = Router();
const creationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many share requests. Try again later.' } });
const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many password attempts. Try again in 15 minutes.' } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many upload requests. Try again later.' } });

router.post('/shares', auth, creationLimiter, createShare);
router.get('/shares', auth, listShares);
router.get('/shares/:id', auth, getShare);
router.patch('/shares/:id', auth, updateShare);
router.delete('/shares/:id', auth, deleteShare);
router.post('/shares/:id/revoke', auth, revokeShare);
router.post('/shares/:id/retention', auth, retention);
router.post('/shares/:id/uploads/initiate', auth, uploadLimiter, initiateUpload);
router.post('/shares/:id/uploads/:uploadId/complete', auth, uploadLimiter, completeUpload);
router.delete('/shares/:id/uploads/:uploadId', auth, cancelUpload);

router.post('/internal/cleanup', (req, res, next) => {
  const configured = process.env.MEDIA_CLEANUP_SECRET;
  if (!configured || req.get('Authorization') !== `Bearer ${configured}`) return res.status(401).json({ success: false, message: 'Authentication required' });
  next();
}, runMediaCleanup);

router.post('/public/:token/verify-password', passwordLimiter, verifyPassword);
router.get('/public/:token', publicAlbum);
router.get('/public/:token/files/:fileId/access', fileAccess);
router.get('/public/:token/files/:fileId', streamFile);
router.get('/public/:token/download-all/ticket', downloadTicket);
router.get('/public/:token/download-all', downloadAll);

export default router;
