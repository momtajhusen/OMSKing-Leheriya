import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendorReturns } from '../../mocks';
import { formatDate } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Textarea from '../../components/ui/Textarea';
import Modal from '../../components/ui/Modal';
import { VendorPage, VendorStat, VendorSheet } from '../../components/vendor/VendorChrome';
import { RotateCcw, Clock, PackageCheck } from 'lucide-react';

const STATUS_VARIANT = {
  'Awaiting Pickup': 'secondary',
  'In Transit': 'default',
  Received: 'default',
  'QC Done': 'outline',
};

const today = () => new Date().toISOString().slice(0, 10);

export default function VendorReturnsPage() {
  const [items, setItems] = useState(vendorReturns);
  const [activeReturn, setActiveReturn] = useState(null);
  const [qcNote, setQcNote] = useState('');

  const awaitingPickup = items.filter((r) => r.status === 'Awaiting Pickup');
  const received = items.filter((r) => r.receivedDate !== '');

  const tiles = [
    { label: 'Total Returns', value: items.length, icon: RotateCcw },
    { label: 'Awaiting Pickup', value: awaitingPickup.length, icon: Clock },
    { label: 'Received', value: received.length, icon: PackageCheck },
  ];

  const openConfirm = (item) => {
    setActiveReturn(item);
    setQcNote(item.qcNote);
  };

  const closeConfirm = () => {
    setActiveReturn(null);
    setQcNote('');
  };

  const confirmReceipt = () => {
    console.log('[Vendor] Confirm return receipt', { id: activeReturn.id, qcNote });
    setItems((prev) =>
      prev.map((r) =>
        r.id === activeReturn.id
          ? { ...r, status: 'Received', receivedDate: r.receivedDate || today(), qcNote }
          : r
      )
    );
    toast.success(`Return ${activeReturn.id} marked received`);
    closeConfirm();
  };

  const markQcDone = (item) => {
    console.log('[Vendor] Mark QC done', { id: item.id });
    setItems((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: 'QC Done' } : r)));
    toast.success(`QC completed for ${item.id}`);
  };

  return (
    <VendorPage title="Returns" subtitle="Items coming back to you. Confirm receipt and add a QC note.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile, i) => (
          <VendorStat key={tile.label} label={tile.label} value={tile.value} icon={tile.icon} tone={['blue', 'amber', 'emerald'][i]} />
        ))}
      </div>

      <VendorSheet>
      <Table className="min-w-[1000px]">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 px-2">Return ID</TableHead>
            <TableHead className="h-9 px-2">Order ID</TableHead>
            <TableHead className="h-9 px-2">Product</TableHead>
            <TableHead className="h-9 px-2">SKU</TableHead>
            <TableHead className="h-9 px-2">Qty</TableHead>
            <TableHead className="h-9 px-2">Reason</TableHead>
            <TableHead className="h-9 px-2">Received Date</TableHead>
            <TableHead className="h-9 px-2">Status</TableHead>
            <TableHead className="h-9 px-2 w-44">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="p-2 font-medium whitespace-nowrap">{item.id}</TableCell>
              <TableCell className="p-2 whitespace-nowrap">{item.orderId}</TableCell>
              <TableCell className="p-2 whitespace-nowrap">{item.product}</TableCell>
              <TableCell className="p-2 font-mono text-xs whitespace-nowrap">{item.sku}</TableCell>
              <TableCell className="p-2">{item.qty}</TableCell>
              <TableCell className="p-2">{item.reason}</TableCell>
              <TableCell className="p-2 whitespace-nowrap">
                {item.receivedDate ? formatDate(item.receivedDate) : '—'}
              </TableCell>
              <TableCell className="p-2">
                <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
                {item.qcNote && (
                  <p className="text-xs text-muted-foreground mt-1 max-w-[14rem]">{item.qcNote}</p>
                )}
              </TableCell>
              <TableCell className="p-2">
                {item.status === 'Awaiting Pickup' || item.status === 'In Transit' ? (
                  <Button size="sm" onClick={() => openConfirm(item)}>
                    Confirm Receipt
                  </Button>
                ) : item.status === 'Received' ? (
                  <Button size="sm" variant="outline" onClick={() => markQcDone(item)}>
                    Mark QC Done
                  </Button>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </VendorSheet>

      <Modal
        open={activeReturn !== null}
        onOpenChange={closeConfirm}
        title="Confirm Receipt"
        description={activeReturn ? `${activeReturn.id} · ${activeReturn.product} · Qty ${activeReturn.qty}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={closeConfirm}>
              Cancel
            </Button>
            <Button onClick={confirmReceipt}>Confirm Received</Button>
          </>
        }
      >
        <label className="block text-sm font-medium mb-2">QC Note</label>
        <Textarea
          value={qcNote}
          onChange={(e) => setQcNote(e.target.value)}
          placeholder="What condition did the item arrive in?"
        />
      </Modal>
    </VendorPage>
  );
}
