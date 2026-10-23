import mongoose from 'mongoose';

const mediaFileSchema = new mongoose.Schema({
  shareId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaShare', required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  publicToken: { type: String, required: true, unique: true, select: false },
  cloudinaryPublicId: { type: String, required: true, unique: true, select: false },
  resourceType: { type: String, enum: ['image', 'video'], required: true },
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true },
  format: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'uploaded', 'deleting', 'delete_failed'], default: 'pending', index: true },
  uploadExpiresAt: { type: Date, required: true }
}, { timestamps: true });

mediaFileSchema.index({ shareId: 1, status: 1, createdAt: 1 });
mediaFileSchema.index({ status: 1, uploadExpiresAt: 1 });

export default mongoose.model('MediaFile', mediaFileSchema);
