import { v2 as cloudinary } from 'cloudinary';

export function cloudinaryClient() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const error = new Error('Media sharing is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET on the API server.');
    error.status = 503;
    throw error;
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
  return cloudinary;
}

export const cloudinaryCaps = {
  imageBytes: Math.min(Number(process.env.MEDIA_MAX_IMAGE_BYTES) || 10 * 1024 * 1024, 10 * 1024 * 1024),
  videoBytes: Math.min(Number(process.env.MEDIA_MAX_VIDEO_BYTES) || 100 * 1024 * 1024, 100 * 1024 * 1024)
};

export const mediaLimits = {
  files: Math.min(Number(process.env.MEDIA_MAX_FILES) || 100, 100),
  shareBytes: Math.min(Number(process.env.MEDIA_MAX_SHARE_BYTES) || 2 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
  concurrentUploads: Math.max(1, Math.min(Number(process.env.MEDIA_CONCURRENT_UPLOADS) || 3, 3)),
  pendingMinutes: 60
};

export const tokenForAsset = (publicId, resourceType, purpose = 'preview') => {
  const cloudinary = cloudinaryClient();
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: 'authenticated',
    sign_url: true,
    secure: true,
    ...(purpose === 'download' ? { flags: 'attachment' } : {})
  });
};

export const privateDownloadUrl = (publicId, format, resourceType, expiresAt, attachment = false, filename) => {
  const cloudinary = cloudinaryClient();
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: 'authenticated',
    expires_at: expiresAt,
    attachment,
    ...(filename ? { target_filename: filename } : {})
  });
};
