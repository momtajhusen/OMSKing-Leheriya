const fs = require('fs');
const AuditLog = require('../models/AuditLog');
const { successResponse } = require('../utils/response');
const { recordFromReq } = require('../services/auditLog.service');
const backup = require('../services/dbBackup.service');

const ACTION = 'platform.db_backup';

const HISTORY_LIMIT = 15;

function record(req, name, after) {
  return recordFromReq(req, {
    tenantId: req.user?.tenantId,
    action: ACTION,
    resourceType: 'database',
    resourceId: name,
    resourceDisplay: name,
    before: null,
    after: { trigger: req.query.trigger === 'auto' ? 'auto' : 'manual', ...after },
  });
}

function historyRow(row) {
  const after = row.after || {};
  return {
    at: row.createdAt,
    status: after.status || 'ok',
    trigger: after.trigger || 'manual',
    name: after.name || '',
    size: after.size || 0,
    drive: after.drive || 'not_connected',
    driveReason: after.driveReason || '',
    reason: after.reason || '',
  };
}

async function download(req, res) {
  let made;
  try {
    made = await backup.createBackup();
  } catch (err) {
    if (err.statusCode !== 409) await record(req, 'failed backup', { status: 'failed', reason: err.message });
    throw err;
  }
  let drive;
  try {
    drive = await backup.uploadToDrive(made);
  } catch (err) {
    drive = { status: 'failed', reason: 'Drive upload error' };
  }
  await record(req, made.name, { status: 'ok', name: made.name, size: made.size, drive: drive.status, driveReason: drive.reason || '' });
  res.set({
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Backup-Name, X-Backup-Drive, X-Backup-Drive-Reason',
    'X-Backup-Name': made.name,
    'X-Backup-Drive': drive.status,
    'X-Backup-Drive-Reason': (drive.reason || '').replace(/[^\x20-\x7e]/g, ''),
    'Cache-Control': 'no-store',
  });
  res.download(made.file, made.name, () => fs.rmSync(made.file, { force: true }));
}

async function status(req, res) {
  const rows = await AuditLog.find({ tenantId: req.user?.tenantId, action: ACTION })
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .setOptions({ skipTenantFilter: true })
    .lean();
  const history = rows.map(historyRow);
  const drive = backup.driveSettings();
  return successResponse(res, {
    drive: { connected: drive.configured, mode: drive.mode, folderSet: Boolean(drive.folderId) },
    last: history[0] || null,
    history,
  }, 'Backup status');
}

module.exports = { download, status };
