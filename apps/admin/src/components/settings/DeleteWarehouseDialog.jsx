import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { FormBanner } from '../ui/FormBanner';
import api, { apiError } from '../../lib/api';
import { deleteSummary } from '../../lib/channelWarehouse';

/** Two-step delete: first shows what the delete would block or change, then deletes on confirm. */
export default function DeleteWarehouseDialog({ warehouse, onClose, onDeleted }) {
  const [check, setCheck] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCheck(null);
    setError('');
    if (!warehouse) return;
    api.get(`/warehouses/${warehouse.id}/delete-check`)
      .then(({ data }) => setCheck(data.data))
      .catch((err) => setError(apiError(err, 'Could not check this warehouse')));
  }, [warehouse]);

  const summary = deleteSummary(check);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.delete(`/warehouses/${warehouse.id}?removeLinks=1`);
      toast.success(`${warehouse.code} deleted`);
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(apiError(err, 'Could not delete'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(warehouse)}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={`Delete ${warehouse?.code || 'warehouse'}`}
      footer={(
        <>
          <Button variant="outline" className="hover:translate-y-0" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            className="hover:translate-y-0"
            disabled={!summary || summary.tone === 'block' || busy}
            onClick={confirm}
          >
            {busy ? 'Deleting...' : summary?.confirmLabel || 'Delete'}
          </Button>
        </>
      )}
    >
      <div className="min-h-[96px] space-y-3">
        {error && <FormBanner tone="error" title="Could not delete">{error}</FormBanner>}
        {!summary && !error && <p className="text-sm text-muted-foreground">Checking stock, orders and channel links...</p>}
        {summary && (
          <FormBanner tone={summary.tone === 'block' ? 'error' : summary.tone === 'warn' ? 'warning' : 'success'} title={summary.title}>
            {summary.lines.length > 0 && (
              <ul className="list-disc space-y-1 pl-4">
                {summary.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </FormBanner>
        )}
        {summary?.tone === 'block' && (
          <p className="text-sm text-muted-foreground">You can set it Inactive instead: it stops showing on every channel and keeps its history.</p>
        )}
      </div>
    </Modal>
  );
}
