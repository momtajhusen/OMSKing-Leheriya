import { useEffect } from 'react';
import { toast } from 'react-hot-toast';
import api from '../lib/api';
import { backupDue, blobMessage, downloadBackup, driveText, readBackupPrefs, takeBackupLock } from '../lib/dbBackup';

const CHECK_EVERY = 10 * 60 * 1000;

export default function useAutoBackup(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const check = async () => {
      if (!backupDue(readBackupPrefs()) || !takeBackupLock()) return;
      const id = toast.loading('Taking today\'s database backup…');
      try {
        const done = await downloadBackup(api, { trigger: 'auto' });
        window.dispatchEvent(new Event('oms-backup-done'));
        toast.success(`Backup saved to Downloads (${done.name}). ${driveText(done.drive, done.driveReason)}`, { id, duration: 8000 });
      } catch (err) {
        toast.error(await blobMessage(err, 'Automatic backup failed. Use Settings → Download backup now.'), { id });
      }
    };
    check();
    const timer = setInterval(check, CHECK_EVERY);
    return () => clearInterval(timer);
  }, [enabled]);
}
