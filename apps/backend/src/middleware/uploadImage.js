const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('../utils/httpError');

const uploadsRoot = path.join(__dirname, '../../uploads');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(uploadsRoot, String(req.avatarFolder || req.tenantId || 'unknown'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safe = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(new HttpError(400, 'Only JPEG, PNG, or WebP images are allowed'));
      return;
    }
    cb(null, true);
  },
});

function uploadProductImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Image must be 5MB or smaller'));
    return next(err);
  });
}

const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(new HttpError(400, 'Only JPEG, PNG, or WebP images are allowed'));
      return;
    }
    cb(null, true);
  },
});

function uploadAvatarImage(req, res, next) {
  const folder = String(req.tenantId || req.user?.homeTenantId || 'platform');
  req.avatarFolder = folder;
  avatarUpload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Photo must be 2MB or smaller'));
    return next(err);
  });
}

function publicUploadPath(tenantId, filename) {
  return `/uploads/${tenantId}/${filename}`;
}

function removeStoredUpload(url, folder) {
  const prefix = `/uploads/${folder}/`;
  if (!url || !url.startsWith(prefix) || url.includes('..')) return;
  const full = path.join(uploadsRoot, folder, path.basename(url));
  fs.unlink(full, () => {});
}

module.exports = { uploadProductImage, uploadAvatarImage, publicUploadPath, removeStoredUpload, uploadsRoot };
