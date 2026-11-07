const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const { HttpError } = require('../utils/httpError');

const deps = { spawn: childProcess.spawn, fetch: (...args) => fetch(...args) };
let running = false;

function backupFileName(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000).toISOString();
  return `omsking-backup-${ist.slice(0, 10)}-${ist.slice(11, 13)}${ist.slice(14, 16)}.archive.gz`;
}

function hideUri(text) {
  return String(text || '').replace(/mongodb(\+srv)?:\/\/[^\s@/]*@/gi, 'mongodb://<hidden>@');
}

function dumpTo(file, uri) {
  return new Promise((resolve, reject) => {
    const child = deps.spawn('mongodump', [`--uri=${uri}`, '--gzip', `--archive=${file}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (err) => reject(new HttpError(500, err.code === 'ENOENT' ? 'mongodump is not installed on the server' : 'Backup could not start')));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      console.error('[backup] mongodump failed', code, hideUri(stderr).slice(-600));
      return reject(new HttpError(500, 'Backup failed on the server'));
    });
  });
}

async function createBackup({ now = new Date(), uri = config.mongodbUri } = {}) {
  if (running) throw new HttpError(409, 'A backup is already running. Try again in a minute.');
  running = true;
  const name = backupFileName(now);
  const file = path.join(os.tmpdir(), `${crypto.randomBytes(6).toString('hex')}-${name}`);
  try {
    await dumpTo(file, uri);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (!size) throw new HttpError(500, 'Backup came out empty');
    return { file, name, size };
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  } finally {
    running = false;
  }
}

function driveSettings(env = process.env) {
  const folderId = String(env.GDRIVE_FOLDER_ID || '').trim();
  const oauth = env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN;
  const keyFile = String(env.GDRIVE_SERVICE_ACCOUNT_FILE || '').trim();
  const mode = oauth ? 'oauth' : keyFile ? 'service_account' : '';
  return { folderId, mode, keyFile, configured: Boolean(mode && (folderId || mode === 'service_account')) };
}

const OWN_FOLDER = 'OMSKing Backups';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

async function ownFolder(token) {
  const auth = { authorization: `Bearer ${token}` };
  const q = encodeURIComponent(`name = '${OWN_FOLDER}' and mimeType = '${FOLDER_TYPE}' and trashed = false`);
  const found = await deps.fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, { headers: auth });
  const existing = (await found.json().catch(() => ({})))?.files?.[0]?.id;
  if (found.ok && existing) return existing;
  const made = await deps.fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: OWN_FOLDER, mimeType: FOLDER_TYPE }),
  });
  const folder = await made.json().catch(() => ({}));
  if (!made.ok || !folder.id) throw new Error(`Drive folder could not be created (${made.status}${folder.error?.errors?.[0]?.reason ? ` ${folder.error.errors[0].reason}` : ''})`);
  return folder.id;
}

function signJwt(key, now = Date.now()) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  return `${body}.${crypto.createSign('RSA-SHA256').update(body).sign(key.private_key, 'base64url')}`;
}

async function driveToken(settings, env = process.env) {
  const form = settings.mode === 'oauth'
    ? { grant_type: 'refresh_token', client_id: env.GDRIVE_CLIENT_ID, client_secret: env.GDRIVE_CLIENT_SECRET, refresh_token: env.GDRIVE_REFRESH_TOKEN }
    : { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(JSON.parse(fs.readFileSync(settings.keyFile, 'utf8'))) };
  const res = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in failed (${res.status} ${data.error || ''})`.trim());
  return data.access_token;
}

async function uploadToDrive({ file, name }, env = process.env) {
  const settings = driveSettings(env);
  if (!settings.configured) return { status: 'not_connected' };
  let folderId = '';
  try {
    const token = await driveToken(settings, env);
    folderId = settings.folderId || await ownFolder(token);
    const start = await deps.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'application/gzip' },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    const location = start.headers.get('location');
    if (!start.ok || !location) {
      const why = (await start.json().catch(() => ({})))?.error?.errors?.[0]?.reason || '';
      throw new Error(`Drive refused the upload (${start.status}${why ? ` ${why}` : ''})`);
    }
    const put = await deps.fetch(location, { method: 'PUT', headers: { 'content-type': 'application/gzip' }, body: fs.readFileSync(file) });
    const saved = await put.json().catch(() => ({}));
    if (!put.ok || !saved.id) {
      const why = saved?.error?.errors?.[0]?.reason || '';
      throw new Error(`Drive upload did not finish (${put.status}${why ? ` ${why}` : ''})`);
    }
    return { status: 'uploaded', fileId: saved.id, folderId };
  } catch (err) {
    console.error('[backup] Google Drive upload failed:', err.message);
    return { status: 'failed', reason: err.message.slice(0, 160), folderId };
  }
}

module.exports = { createBackup, uploadToDrive, driveSettings, backupFileName, hideUri, deps };
