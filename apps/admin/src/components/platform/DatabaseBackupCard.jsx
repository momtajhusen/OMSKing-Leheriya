import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { CalendarClock, CheckCircle2, Cloud, DatabaseBackup, Download, XCircle } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import {
  BACKUP_AUTO_KEY, EVENING_HOUR, blobMessage, downloadBackup, driveText, formatBytes, nextAutoBackup, nextAutoText, readBackupPrefs, savedHere, takeBackupLock,
} from '../../lib/dbBackup';

const OK = 'border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300';
const DRIVE = {
  uploaded: { label: 'Uploaded', className: OK },
  failed: { label: 'Failed', variant: 'destructive' },
  not_connected: { label: 'Not connected', variant: 'outline' },
};

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Tile({ icon: Icon, label, children }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
      <div className="mt-1.5 text-sm">{children}</div>
    </div>
  );
}

export default function DatabaseBackupCard() {
  const [prefs, setPrefs] = useState(() => readBackupPrefs());
  const [saved, setSaved] = useState(() => savedHere());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = () => api.get('/tenants/ops/backup/status')
    .then(({ data }) => setStatus(data.data))
    .catch((err) => toast.error(apiError(err, 'Could not load backup status')));

  useEffect(() => {
    loadStatus();
    const refresh = () => { setPrefs(readBackupPrefs()); setSaved(savedHere()); loadStatus(); };
    window.addEventListener('oms-backup-done', refresh);
    return () => window.removeEventListener('oms-backup-done', refresh);
  }, []);

  const runNow = async () => {
    if (!takeBackupLock()) {
      toast.error('A backup is already running in another tab');
      return;
    }
    setBusy(true);
    try {
      const done = await downloadBackup(api);
      toast.success(`Backup saved to Downloads. ${driveText(done.drive, done.driveReason)}`, { duration: 8000 });
    } catch (err) {
      toast.error(await blobMessage(err, 'Backup failed'));
    } finally {
      setBusy(false);
      setPrefs(readBackupPrefs());
      setSaved(savedHere());
      loadStatus();
    }
  };

  const toggleAuto = (on) => {
    localStorage.setItem(BACKUP_AUTO_KEY, on ? 'on' : 'off');
    setPrefs(readBackupPrefs());
  };

  const last = status?.last;
  const history = status?.history || [];
  const drive = status?.drive;
  const next = nextAutoBackup(prefs);

  return (
    <section className="premium-card max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <DatabaseBackup className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Database backup</p>
            <p className="max-w-xl text-muted-foreground">
              A full copy of the OMSKing database (every company) in one compressed file. It saves to this computer&apos;s Downloads folder
              {drive?.connected ? ' and to the Google Drive backup folder.' : '.'}
            </p>
          </div>
        </div>
        <Button type="button" className="shrink-0 hover:translate-y-0" onClick={runNow} disabled={busy}>
          <Download className="mr-2 h-4 w-4" />
          {busy ? 'Taking backup…' : 'Download backup now'}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={last?.status === 'failed' ? XCircle : CheckCircle2} label="Last backup">
          {last ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{when(last.at)}</span>
                {last.status === 'failed' ? <Badge variant="destructive">Failed</Badge> : <Badge className={OK}>Succeeded</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {last.status === 'failed' ? last.reason : `${formatBytes(last.size)} · ${last.trigger === 'auto' ? 'Automatic' : 'Manual'}`}
              </p>
            </>
          ) : <span className="text-muted-foreground">{status ? 'No backup yet' : 'Loading…'}</span>}
        </Tile>
        <Tile icon={CalendarClock} label="Next automatic backup">
          <span className="font-medium">{nextAutoText(next)}</span>
          <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={prefs.auto} onChange={(event) => toggleAuto(event.target.checked)} />
            Automatic on this computer
          </label>
        </Tile>
        <Tile icon={Cloud} label="Google Drive">
          {drive?.connected
            ? <Badge className={OK}>Connected</Badge>
            : <Badge variant="outline">Not connected</Badge>}
          <p className="mt-1 text-xs text-muted-foreground">
            {drive?.connected ? 'Each backup is also uploaded to the Drive folder.' : 'Set the Google Drive keys in the server env to turn it on.'}
          </p>
        </Tile>
      </div>

      <p className="text-xs text-muted-foreground">
        Automatic backups run in this browser once a day after {EVENING_HOUR}:00 while OMSKing is open, or as soon as it opens if the last one is over a day old.
        Chrome saves them to Downloads without asking unless &quot;Ask where to save each file&quot; is on.
      </p>

      <div>
        <p className="mb-2 text-sm font-medium">Recent backups</p>
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No backups yet. Take the first one with Download backup now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>This computer</TableHead>
                <TableHead>Google Drive</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => {
                const driveBadge = DRIVE[row.drive] || DRIVE.not_connected;
                return (
                  <TableRow key={`${row.at}-${row.name}`}>
                    <TableCell className="whitespace-nowrap text-sm">{when(row.at)}</TableCell>
                    <TableCell className="text-sm">{row.trigger === 'auto' ? 'Automatic' : 'Manual'}</TableCell>
                    <TableCell className="text-sm">{formatBytes(row.size)}</TableCell>
                    <TableCell>
                      {row.status === 'failed'
                        ? <Badge variant="destructive" title={row.reason}>Failed</Badge>
                        : <Badge className={OK}>Succeeded</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.status !== 'failed' && saved.has(row.name) ? 'Saved' : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {row.status === 'failed'
                        ? <span className="text-sm text-muted-foreground">—</span>
                        : <Badge variant={driveBadge.variant} className={driveBadge.className} title={row.driveReason}>{driveBadge.label}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
