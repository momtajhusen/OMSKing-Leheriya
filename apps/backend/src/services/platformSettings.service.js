const PlatformSetting = require('../models/PlatformSetting');
const config = require('../config');
const { HttpError } = require('../utils/httpError');
const { encryptObject, decryptObject } = require('../lib/secretBox');

const KEY = 'default';
let cache = null;

function envMailbox() {
  const user = String(config.mail.user || '').trim();
  const pass = String(config.mail.pass || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return { user, pass, from: config.mail.from || user };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function remembered(row) {
  cache = row || null;
  return cache;
}

async function loadRow() {
  const row = await PlatformSetting.findOne({ key: KEY });
  return remembered(row);
}

function emailBrandSync() {
  return String(cache?.emailBrand || 'OMSKing').trim() || 'OMSKing';
}

function fromNameSync() {
  return String(cache?.fromName || 'OMSKing').trim() || 'OMSKing';
}

function loginUrlSync() {
  const saved = String(cache?.publicAppUrl || '').trim().replace(/\/$/, '');
  if (saved) return `${saved}/auth/login`;
  const web = (config.corsOrigins || []).find((origin) => origin.startsWith('https://'))
    || (config.corsOrigins || [])[0]
    || 'http://localhost:5173';
  return `${web}/auth/login`;
}

async function trialLengthDays() {
  const row = cache || await loadRow();
  return clampInt(row?.trialDays, 1, 90, 14);
}

async function orderPullMinutes() {
  const row = cache || await loadRow();
  const saved = clampInt(row?.orderPullMinutes, 1, 1440, 0);
  if (saved) return saved;
  return clampInt(Number(process.env.MYNTRA_PULL_MINUTES || 15), 1, 1440, 15);
}

async function platformMailboxFromSettings() {
  const row = await loadRow();
  const user = String(row?.gmailUser || '').trim();
  const pass = String(decryptObject(row?.gmailAppPasswordEnc).pass || '').replace(/\s+/g, '');
  if (user && pass) {
    return { user, pass, from: user, fromName: fromNameSync(), source: 'panel' };
  }
  const env = envMailbox();
  if (!env) return null;
  return { ...env, fromName: fromNameSync(), source: 'env' };
}

function present(row, box) {
  const panelReady = Boolean(row?.gmailUser && row?.gmailAppPasswordEnc);
  return {
    gmailUser: row?.gmailUser || '',
    mailConfigured: Boolean(box),
    mailSource: box?.source || 'missing',
    activeGmail: box?.user || '',
    fromName: row?.fromName || 'OMSKing',
    emailBrand: row?.emailBrand || 'OMSKing',
    trialDays: clampInt(row?.trialDays, 1, 90, 14),
    orderPullMinutes: clampInt(row?.orderPullMinutes, 1, 1440, clampInt(Number(process.env.MYNTRA_PULL_MINUTES || 15), 1, 1440, 15)),
    publicAppUrl: row?.publicAppUrl || '',
    panelMailReady: panelReady,
  };
}

async function getPlatformSettings() {
  const row = await loadRow();
  const box = await platformMailboxFromSettings();
  return present(row, box);
}

function cleanUrl(value) {
  const url = String(value || '').trim().replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new HttpError(400, 'App link must start with http:// or https://');
  return url;
}

async function savePlatformSettings(body = {}) {
  const beforeRow = await loadRow();
  const before = present(beforeRow, await platformMailboxFromSettings());
  const row = beforeRow || new PlatformSetting({ key: KEY });
  if (body.gmailUser != null) {
    const gmailUser = String(body.gmailUser).trim().toLowerCase();
    if (gmailUser && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailUser)) {
      throw new HttpError(400, 'Enter the Gmail address that sends client OTP');
    }
    row.gmailUser = gmailUser;
    if (!gmailUser) row.gmailAppPasswordEnc = '';
  }
  const appPassword = String(body.gmailAppPassword || '').trim();
  if (appPassword) {
    if (!row.gmailUser) throw new HttpError(400, 'Gmail address is required with the app password');
    row.gmailAppPasswordEnc = encryptObject({ pass: appPassword });
  }
  if (body.fromName != null) {
    const fromName = String(body.fromName).trim();
    if (fromName.length < 2) throw new HttpError(400, 'Sender name is required');
    row.fromName = fromName.slice(0, 40);
  }
  if (body.emailBrand != null) {
    const emailBrand = String(body.emailBrand).trim();
    if (emailBrand.length < 2) throw new HttpError(400, 'Email footer name is required');
    row.emailBrand = emailBrand.slice(0, 80);
  }
  if (body.trialDays != null) row.trialDays = clampInt(body.trialDays, 1, 90, 14);
  if (body.orderPullMinutes != null) row.orderPullMinutes = clampInt(body.orderPullMinutes, 1, 1440, 15);
  if (body.publicAppUrl != null) row.publicAppUrl = cleanUrl(body.publicAppUrl);
  await row.save();
  remembered(row);
  const { startChannelScheduler } = require('./channelScheduler.service');
  await startChannelScheduler();
  const after = present(row, await platformMailboxFromSettings());
  return { before, after };
}

async function publicPlatformSettings() {
  const row = cache || await loadRow();
  return { trialDays: clampInt(row?.trialDays, 1, 90, 14) };
}

module.exports = {
  getPlatformSettings,
  savePlatformSettings,
  publicPlatformSettings,
  platformMailboxFromSettings,
  trialLengthDays,
  orderPullMinutes,
  emailBrandSync,
  fromNameSync,
  loginUrlSync,
};
