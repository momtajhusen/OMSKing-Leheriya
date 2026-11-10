import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', confirmDisabled = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next && !busy) onClose(); }}
      title={title}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy || confirmDisabled} onClick={confirm}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="text-sm text-muted-foreground">{children}</div>
    </Modal>
  );
}
