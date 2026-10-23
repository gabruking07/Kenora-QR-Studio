import mongoose from 'mongoose';

const mediaShareSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 1000 },
  passwordHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['active', 'expired', 'revoked', 'deleting'], default: 'active', index: true },
  retention: { type: String, enum: ['pending', 'keep', 'delete'], default: 'pending' },
  fileCount: { type: Number, default: 0 },
  totalBytes: { type: Number, default: 0 },
  reservedCount: { type: Number, default: 0 },
  reservedBytes: { type: Number, default: 0 }
}, { timestamps: true });

mediaShareSchema.index({ ownerId: 1, createdAt: -1 });
mediaShareSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('MediaShare', mediaShareSchema);
