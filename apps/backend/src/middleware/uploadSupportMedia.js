const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('../utils/httpError');

/** Outside `uploads/`, which express serves to anyone. Files here are only read through signed links. */
const supportMediaRoot = path.join(__dirname, '../../private-uploads/support');

const MAX_BYTES = {
  image: 10 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(supportMediaRoot, String(req.supportTenantId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.upload`);
  },
});

function declaredKind(mime) {
  const family = String(mime || '').split('/')[0];
  return MAX_BYTES[family] ? family : null;
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES.video, files: 1 },
  fileFilter(req, file, cb) {
    if (!declaredKind(file.mimetype)) {
      cb(new HttpError(400, 'Send a photo, video or voice note'));
      return;
    }
    cb(null, true);
  },
});

function uploadSupportMedia(req, res, next) {
  if (!req.supportTenantId) return next(new HttpError(403, 'No tenant on this session'));
  return upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'File must be 50MB or smaller'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return next(new HttpError(400, 'Send one file per message'));
    }
    return next(err);
  });
}

function readHead(file, size = 16) {
  const head = Buffer.alloc(size);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, size, 0);
  } finally {
    fs.closeSync(fd);
  }
  return head;
}

/** Real format from the first bytes; the browser's declared type only picks audio vs video for shared containers. */
function sniffMedia(filePath, declaredMime) {
  const kind = declaredKind(declaredMime);
  if (!kind) return null;
  const head = readHead(filePath);
  const ascii = (from, to) => head.toString('ascii', from, to);

  if (kind === 'image') {
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind, ext: '.png', mime: 'image/png' };
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind, ext: '.jpg', mime: 'image/jpeg' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind, ext: '.webp', mime: 'image/webp' };
    if (ascii(0, 4) === 'GIF8') return { kind, ext: '.gif', mime: 'image/gif' };
    return null;
  }

  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { kind, ext: '.webm', mime: `${kind}/webm` };
  if (ascii(4, 8) === 'ftyp') {
    if (ascii(8, 12) === 'qt  ' && kind === 'video') return { kind, ext: '.mov', mime: 'video/quicktime' };
    return kind === 'audio' ? { kind, ext: '.m4a', mime: 'audio/mp4' } : { kind, ext: '.mp4', mime: 'video/mp4' };
  }
  if (ascii(0, 4) === 'OggS') return { kind, ext: '.ogg', mime: `${kind}/ogg` };
  if (kind === 'audio') {
    if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return { kind, ext: '.mp3', mime: 'audio/mpeg' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind, ext: '.wav', mime: 'audio/wav' };
  }
  return null;
}

function discardUpload(file) {
  if (file?.path) fs.rmSync(file.path, { force: true });
}

module.exports = {
  uploadSupportMedia,
  sniffMedia,
  discardUpload,
  supportMediaRoot,
  MAX_BYTES,
};
