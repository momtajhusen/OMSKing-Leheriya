import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { vendorLines } from '../../lib/vendorLines';
import { formatDate, formatINR } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import Modal from '../../components/ui/Modal';
import { VendorPage, VendorBulkBar, VendorSheet } from '../../components/vendor/VendorChrome';
import VendorProductThumb from '../../components/vendor/VendorProductThumb';
import VendorCourierPick, { resolveVendorCourier } from '../../components/vendor/VendorCourierPick';
import Badge from '../../components/ui/Badge';
import { DISPATCH_SLA_DAYS, DISPATCH_URGENT_MESSAGE, isDispatchOverdue } from '../../lib/vendorDispatchAlert';
import { Save, Truck, Check, X, Inbox, MessageCircle } from 'lucide-react';

const TABS = [
  { id: 'All', label: 'All Orders' },
  { id: 'Pending', label: 'Pending' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
];

const tabStatus = {
  Pending: ['Pending Acceptance', 'Accepted', 'Ready to Dispatch'],
  'In Transit': ['Dispatched'],
  Delivered: ['Delivered'],
};

const EDITABLE = ['trackingNumber', 'courier', 'dispatchedDate', 'deliveryDate'];

export default function VendorOrdersPage() {
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const loadError = useOrderStore((s) => s.error);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const vendorUpdate = useOrderStore((s) => s.vendorUpdate);
  const rows = useMemo(() => vendorLines(orders), [orders]);
  const [edits, setEdits] = useState({});
  const [activeTab, setActiveTab] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkCourier, setBulkCourier] = useState('');
  const [bulkOtherName, setBulkOtherName] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const view = (row) => ({ ...row, ...edits[row.id] });
  const isDirty = (row) => Boolean(edits[row.id]) && EDITABLE.some((key) => key in edits[row.id] && edits[row.id][key] !== row[key]);

  const visibleRows = rows.map(view).filter((r) => {
    const matchesTab = activeTab === 'All' || (tabStatus[activeTab] || []).includes(r.status);
    const date = String(r.assignedDate).slice(0, 10);
    return matchesTab && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  });
  const dirtyRows = rows.filter(isDirty);
  const overdueRows = rows.filter((row) => isDispatchOverdue(row));
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.includes(r.id));

  const updateCell = (id, field, value) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const toggleRow = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleAllVisible = () => setSelectedIds(allVisibleSelected ? [] : visibleRows.map((r) => r.id));

  /** Saves one line: dispatches when tracking + courier are filled on an accepted line, delivers when a delivery date is set. */
  const persist = async (base) => {
    const row = view(base);
    const fields = {
      trackingNumber: row.trackingNumber,
      courier: row.courier,
      dispatchDate: row.dispatchedDate,
      deliveredDate: row.deliveryDate,
    };
    let action = 'save';
    if (['Accepted', 'Ready to Dispatch'].includes(row.status) && row.trackingNumber && row.courier) action = 'dispatch';
    if (row.status === 'Dispatched' && row.deliveryDate) action = 'deliver';
    const next = await vendorUpdate(row.masterId, row.id, { action, ...fields });
    if (next?.error) return { error: `${row.orderId}: ${next.error}` };
    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[row.id];
      return copy;
    });
    return { action };
  };

  const respond = async (row, action, reason) => {
    setBusy(row.id);
    const next = await vendorUpdate(row.masterId, row.id, { action, reason });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return false;
    }
    toast.success(action === 'accept' ? `${row.orderId} accepted` : `${row.orderId} rejected`);
    return true;
  };

  const saveRow = async (row) => {
    setBusy(row.id);
    const result = await persist(row);
    setBusy('');
    if (result.error) toast.error(result.error);
    else toast.success(result.action === 'dispatch' ? `${row.orderId} dispatched` : result.action === 'deliver' ? `${row.orderId} delivered` : `Saved ${row.orderId}`);
  };

  const saveMany = async (list) => {
    setBusy('bulk');
    const errors = [];
    for (const row of list) {
      const result = await persist(row);
      if (result.error) errors.push(result.error);
    }
    setBusy('');
    if (errors.length) toast.error(errors[0]);
    if (list.length - errors.length) toast.success(`Saved ${list.length - errors.length} ${list.length - errors.length === 1 ? 'line' : 'lines'}`);
  };

  const applyBulkTracking = async () => {
    const courier = resolveVendorCourier(bulkCourier, bulkOtherName);
    if (!bulkTracking.trim() || !courier) {
      toast.error('Enter the tracking number and your courier');
      return;
    }
    const picked = rows.filter((row) => selectedIds.includes(row.id));
    picked.forEach((row) => { edits[row.id] = { ...edits[row.id], trackingNumber: bulkTracking.trim(), courier }; });
    setEdits({ ...edits });
    await saveMany(picked);
    setSelectedIds([]);
    setBulkTracking('');
    setBulkCourier('');
    setBulkOtherName('');
  };

  if (!loaded) return <PageLoader label="Loading your orders..." />;

  return (
    <VendorPage
      title="My Orders"
      subtitle="Accept or reject each line. Fill tracking + courier and Save to dispatch. Tick rows that go in one parcel."
      action={(
        <Button type="button" onClick={() => saveMany(dirtyRows)} disabled={dirtyRows.length === 0 || busy === 'bulk'}>
          <Save className="h-4 w-4 mr-2" />
          Save{dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ''}
        </Button>
      )}
    >
      {loadError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>}

      {overdueRows.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{overdueRows.length} {overdueRows.length === 1 ? 'line' : 'lines'} not dispatched in {DISPATCH_SLA_DAYS} days</p>
            <p className="mt-0.5 text-amber-900/80 dark:text-amber-100/80">
              {DISPATCH_URGENT_MESSAGE}. {overdueRows.map((row) => row.orderId).join(', ')}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {TABS.map((tab) => {
          const count = tab.id === 'All' ? rows.length : rows.filter((r) => (tabStatus[tab.id] || []).includes(r.status)).length;
          return (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'}
              onClick={() => { setActiveTab(tab.id); setSelectedIds([]); }}
            >
              {tab.label}
              <span className="tabular-nums opacity-80">({count})</span>
            </button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input type="date" className="h-9 w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input type="date" className="h-9 w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <VendorBulkBar>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              <Truck className="h-4 w-4" />
              One parcel, one tracking
            </div>
            <div className="w-56">
              <label className="mb-1 block text-xs text-muted-foreground">Tracking ID</label>
              <Input className="h-9" value={bulkTracking} onChange={(e) => setBulkTracking(e.target.value)} placeholder="From your courier" />
            </div>
            <VendorCourierPick
              className="min-w-[12rem]"
              value={bulkCourier}
              otherName={bulkOtherName}
              onChange={(next) => { setBulkCourier(next); if (next !== 'Other') setBulkOtherName(''); }}
              onOtherName={setBulkOtherName}
            />
            <Button onClick={applyBulkTracking} disabled={busy === 'bulk'}>Apply to {selectedIds.length} selected</Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])}>Clear</Button>
          </div>
        </VendorBulkBar>
      )}

      {visibleRows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
          title="No orders here"
          description={rows.length ? `You have no orders in "${activeTab}".` : 'No lines are assigned to you yet.'}
        />
      ) : (
        <VendorSheet>
          <Table className="min-w-[1280px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-2 w-10">
                  <input type="checkbox" className="h-4 w-4 align-middle" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all orders" />
                </TableHead>
                <TableHead className="h-9 px-2">Assigned</TableHead>
                <TableHead className="h-9 px-2">Order ID</TableHead>
                <TableHead className="h-9 px-2">Photo</TableHead>
                <TableHead className="h-9 px-2">Price</TableHead>
                <TableHead className="h-9 px-2 w-36">Courier</TableHead>
                <TableHead className="h-9 px-2 w-48">Tracking ID</TableHead>
                <TableHead className="h-9 px-2 w-40">
                  Dispatch Date
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Optional</span>
                </TableHead>
                <TableHead className="h-9 px-2 w-40">
                  Date of Delivery
                  <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Optional</span>
                </TableHead>
                <TableHead className="h-9 px-2 w-72">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const base = rows.find((r) => r.id === row.id);
                const overdue = isDispatchOverdue(row);
                const dirty = isDirty(base);
                const pending = row.status === 'Pending Acceptance';
                const locked = pending || row.status === 'Rejected' || row.status === 'Delivered';
                return (
                  <TableRow key={row.id} className={dirty ? 'bg-amber-50/70 dark:bg-amber-950/20' : overdue ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}>
                    <TableCell className="p-2">
                      <input type="checkbox" className="h-4 w-4 align-middle" checked={selectedIds.includes(row.id)} onChange={() => toggleRow(row.id)} aria-label={`Select order ${row.orderId}`} disabled={locked} />
                    </TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{row.assignedDate ? formatDate(row.assignedDate) : '—'}</TableCell>
                    <TableCell className="p-2 font-medium whitespace-nowrap">
                      {row.orderId}
                      <div className="text-xs text-muted-foreground">{row.product}</div>
                      <div className="text-[11px] text-muted-foreground">{row.sku}{row.customerCity ? ` · ${row.customerCity}` : ''}</div>
                    </TableCell>
                    <TableCell className="p-2"><VendorProductThumb name={row.product} src={row.imageUrl} /></TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{formatINR(row.assignPrice)}</TableCell>
                    <TableCell className="p-1">
                      <Input className="h-9" value={row.courier} disabled={locked} onChange={(e) => updateCell(row.id, 'courier', e.target.value)} placeholder="Courier" />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input className="h-9" value={row.trackingNumber} disabled={locked} onChange={(e) => updateCell(row.id, 'trackingNumber', e.target.value)} placeholder="Tracking ID" />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input className="h-9" type="date" value={String(row.dispatchedDate || '').slice(0, 10)} disabled={locked} onChange={(e) => updateCell(row.id, 'dispatchedDate', e.target.value)} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input className="h-9" type="date" value={String(row.deliveryDate || '').slice(0, 10)} disabled={row.status !== 'Dispatched'} onChange={(e) => updateCell(row.id, 'deliveryDate', e.target.value)} />
                    </TableCell>
                    <TableCell className="p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pending ? (
                          <>
                            <Button type="button" size="sm" disabled={busy === row.id} onClick={() => respond(row, 'accept')}>
                              <Check className="h-4 w-4 mr-1" />
                              Accept
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => { setRejectFor(row); setRejectReason(''); }}>
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </>
                        ) : (
                          <Badge variant={row.status === 'Rejected' ? 'destructive' : 'outline'} title={row.rejectReason}>{row.status}</Badge>
                        )}
                        {!locked && (
                          <Button type="button" size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || busy === row.id} onClick={() => saveRow(base)}>
                            <Save className="h-4 w-4 mr-1" />
                            Save
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </VendorSheet>
      )}

      <Modal
        open={!!rejectFor}
        onOpenChange={(open) => !open && setRejectFor(null)}
        title={rejectFor ? `Reject ${rejectFor.orderId}` : 'Reject'}
        description="The merchant sees this reason and can assign the line to someone else."
        footer={(
          <>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || busy === rejectFor?.id}
              onClick={async () => { if (await respond(rejectFor, 'reject', rejectReason.trim())) setRejectFor(null); }}
            >
              Reject line
            </Button>
          </>
        )}
      >
        <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Out of stock / cannot make in time…" />
      </Modal>
    </VendorPage>
  );
}
