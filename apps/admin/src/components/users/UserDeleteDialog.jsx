import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function UserDeleteDialog({ user, onClose, onDeleted }) {
  const [impact, setImpact] = useState(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    setImpact(null);
    setAck(false);
    if (!user) return undefined;
    let live = true;
    api.get(`/users/${user.id}/delete-impact`)
      .then(({ data }) => { if (live) setImpact(data.data); })
      .catch((err) => {
        if (!live) return;
        toast.error(apiError(err, 'Could not check this user\'s data'));
        onClose();
      });
    return () => { live = false; };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    try {
      await api.delete(`/users/${user.id}`, { data: impact?.needsConfirm ? { confirmLinkedData: true } : undefined });
      toast.success(`${user.name} deleted`);
      onDeleted(user);
    } catch (err) {
      toast.error(apiError(err, 'Could not delete this user'));
    }
  };

  return (
    <ConfirmDialog
      open={Boolean(user)}
      title={`Delete ${user?.name || 'user'}?`}
      confirmLabel="Delete user"
      confirmDisabled={!impact || (impact.needsConfirm && !ack)}
      onConfirm={remove}
      onClose={onClose}
    >
      <p>{user?.email} loses access straight away. To pause access instead, use Disable.</p>
      {!impact && <p className="mt-3">Checking linked data…</p>}
      {impact?.needsConfirm && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This user has linked data. Read the list before you delete.</span>
          </div>
          {impact.removed.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Will be deleted</p>
              <ul className="mt-1 list-disc pl-5">
                {impact.removed.map((row) => <li key={row.key}>{row.label}: {row.count}</li>)}
              </ul>
            </div>
          )}
          {impact.kept.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Stays for history (shown without this user)</p>
              <ul className="mt-1 list-disc pl-5">
                {impact.kept.map((row) => <li key={row.key}>{row.label}: {row.count}</li>)}
              </ul>
            </div>
          )}
          <label className="flex items-start gap-2 text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-destructive"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            <span>I understand this data is deleted and the user cannot be restored.</span>
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}
