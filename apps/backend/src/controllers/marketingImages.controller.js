const fs = require('fs');
const path = require('path');
const MarketingImage = require('../models/MarketingImage');
const User = require('../models/User');
const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const { recordFromReq } = require('../services/auditLog.service');
const { publicUploadPath, removeStoredUpload, MARKETING_FOLDER } = require('../middleware/uploadImage');

const NAME_PATTERN = /^(home|features|pricing|demo|about|contact|login)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALT_MAX = 160;

function imageKind(file) {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, head, 0, 12, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  return null;
}

function discard(file) {
  if (file?.path) fs.rmSync(file.path, { force: true });
}

function toDto(row) {
  return {
    name: row.name,
    url: row.url,
    alt: row.alt || '',
    mime: row.mime || '',
    bytes: row.bytes || 0,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName || '',
  };
}

function checkName(req, res, next) {
  if (!NAME_PATTERN.test(String(req.params.name || '')) || req.params.name.length > 64) {
    return next(new HttpError(400, 'Unknown website image name'));
  }
  return next();
}

function readAlt(value) {
  if (value === undefined || value === null) return undefined;
  const alt = String(value).trim();
  if (alt.length > ALT_MAX) throw new HttpError(400, `Alt text must be ${ALT_MAX} characters or fewer`);
  return alt;
}

async function editorName(req) {
  const user = await User.findById(req.user.id).select('fullName').setOptions({ skipTenantFilter: true }).lean();
  return user?.fullName || '';
}

async function publicImages(req, res) {
  const rows = await MarketingImage.find({}).select('name url alt updatedAt').lean();
  const map = {};
  rows.forEach((row) => {
    map[row.name] = { url: row.url, alt: row.alt || '', updatedAt: row.updatedAt };
  });
  res.set('Cache-Control', 'public, max-age=60');
  return successResponse(res, map, 'Website images');
}

async function listImages(req, res) {
  const rows = await MarketingImage.find({}).sort({ name: 1 }).lean();
  return successResponse(res, rows.map(toDto), 'Website images');
}

async function saveImage(req, res) {
  const { name } = req.params;
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose an image to upload');

  let alt;
  try {
    alt = readAlt(req.body?.alt);
  } catch (err) {
    discard(file);
    throw err;
  }

  const kind = imageKind(file.path);
  if (!kind) {
    discard(file);
    throw new HttpError(400, 'This file is not a real PNG, JPEG or WebP image');
  }
  const filename = `${path.basename(file.filename, path.extname(file.filename))}${kind.ext}`;
  if (filename !== file.filename) fs.renameSync(file.path, path.join(path.dirname(file.path), filename));

  const before = await MarketingImage.findOne({ name }).lean();
  const updatedByName = await editorName(req);
  const row = await MarketingImage.findOneAndUpdate(
    { name },
    {
      $set: {
        url: publicUploadPath(MARKETING_FOLDER, filename),
        mime: kind.mime,
        bytes: file.size || 0,
        updatedBy: req.user.id,
        updatedByName,
        ...(alt !== undefined ? { alt } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  if (before?.url && before.url !== row.url) removeStoredUpload(before.url, MARKETING_FOLDER);

  await recordFromReq(req, {
    tenantId: req.user?.tenantId,
    action: before ? 'platform.marketing_image_replaced' : 'platform.marketing_image_uploaded',
    resourceType: 'marketing_image',
    resourceDisplay: name,
    before: before ? { url: before.url, alt: before.alt } : null,
    after: { url: row.url, alt: row.alt },
  });
  return successResponse(res, toDto(row), before ? 'Image replaced' : 'Image uploaded');
}

async function updateImage(req, res) {
  const { name } = req.params;
  const alt = readAlt(req.body?.alt) ?? '';
  const before = await MarketingImage.findOne({ name }).lean();
  if (!before) throw new HttpError(404, 'Upload this image first');
  const updatedByName = await editorName(req);
  const row = await MarketingImage.findOneAndUpdate(
    { name },
    { $set: { alt, updatedBy: req.user.id, updatedByName } },
    { new: true },
  ).lean();
  await recordFromReq(req, {
    tenantId: req.user?.tenantId,
    action: 'platform.marketing_image_updated',
    resourceType: 'marketing_image',
    resourceDisplay: name,
    before: { alt: before.alt },
    after: { alt: row.alt },
  });
  return successResponse(res, toDto(row), 'Alt text saved');
}

async function removeImage(req, res) {
  const { name } = req.params;
  const row = await MarketingImage.findOneAndDelete({ name }).lean();
  if (!row) throw new HttpError(404, 'This image is not uploaded');
  removeStoredUpload(row.url, MARKETING_FOLDER);
  await recordFromReq(req, {
    tenantId: req.user?.tenantId,
    action: 'platform.marketing_image_removed',
    resourceType: 'marketing_image',
    resourceDisplay: name,
    before: { url: row.url, alt: row.alt },
    after: null,
  });
  return successResponse(res, { name }, 'Image removed');
}

module.exports = { checkName, publicImages, listImages, saveImage, updateImage, removeImage, NAME_PATTERN };
