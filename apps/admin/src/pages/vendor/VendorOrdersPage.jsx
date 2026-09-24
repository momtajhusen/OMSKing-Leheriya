import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendorOrders } from '../../mocks';
import { formatDate } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import EmptyState from '../../components/ui/EmptyState';
import { VendorPage, VendorBulkBar, VendorSheet } from '../../components/vendor/VendorChrome';
import Badge from '../../components/ui/Badge';
import { Save, Truck, Check, X, Inbox } from 'lucide-react';

const TABS = [
  { id: 'All', label: 'All Orders' },
  { id: 'Pending', label: 'Pending' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
];
const COURIERS = ['Delhivery', 'Bluedart', 'Ecom Express', 'Xpressbees', 'Other'];

const ORIGINAL = new Map(vendorOrders.map((o) => [o.id, o]));

const tabStatus = {
  Pending: ['Pending Acceptance', 'Accepted', 'Ready to Dispatch'],
  'In Transit': ['Dispatched'],
  Delivered: ['Delivered'],
};

const isDirty = (row) => {
  const original = ORIGINAL.get(row.id);
  return (
    original.trackingNumber !== row.trackingNumber ||
    original.courier !== row.courier ||
    original.dispatchedDate !== row.dispatchedDate ||
    original.deliveryDate !== row.deliveryDate ||
    original.assignPrice !== row.assignPrice
  );
};

function ProductThumb({ name }) {
  const letter = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-xs font-bold text-white shadow-sm"
      aria-label={name}
    >
      {letter}
    </div>
  );
}

export default function VendorOrdersPage() {
  const [rows, setRows] = useState(vendorOrders);
  const [activeTab, setActiveTab] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkCourier, setBulkCourier] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const visibleRows = rows.filter((r) => {
    const matchesTab =
      activeTab === 'All' || (tabStatus[activeTab] || []).includes(r.status);
    const matchesFrom = !fromDate || r.assignedDate >= fromDate;
    const matchesTo = !toDate || r.assignedDate <= toDate;
    return matchesTab && matchesFrom && matchesTo;
  });
  const dirtyRows = rows.filter(isDirty);
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selectedIds.includes(r.id));

  const changeTab = (tab) => {
    setActiveTab(tab);
    setSelectedIds([]);
  };

  const updateCell = (id, field, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const toggleRow = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? [] : visibleRows.map((r) => r.id));
  };

  const respond = (id, status) => {
    console.log('[Vendor] Order response', { id, status });
    updateCell(id, 'status', status);
    toast.success(status === 'Accepted' ? `Order ${id} accepted` : `Order ${id} rejected`);
  };

  const applyBulkTracking = () => {
    if (!bulkTracking.trim() && !bulkCourier) {
      toast.error('Enter a tracking number or pick a courier first');
      return;
    }
    console.log('[Vendor] Bulk tracking update', {
      ids: selectedIds,
      trackingNumber: bulkTracking.trim(),
      courier: bulkCourier,
    });
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.includes(r.id)
          ? {
              ...r,
              trackingNumber: bulkTracking.trim() || r.trackingNumber,
              courier: bulkCourier || r.courier,
            }
          : r
      )
    );
    toast.success(`Tracking applied to ${selectedIds.length} orders`);
    setSelectedIds([]);
    setBulkTracking('');
    setBulkCourier('');
  };

  const saveAll = () => {
    console.log('[Vendor] Save all changes', dirtyRows);
    toast.success(`Saved ${dirtyRows.length} changed ${dirtyRows.length === 1 ? 'row' : 'rows'}`);
  };

  return (
    <VendorPage
      title="My Orders"
      subtitle="Spreadsheet: type dates and tracking, then Save. Tick rows that go in one parcel."
      action={
        <Button onClick={saveAll} disabled={dirtyRows.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          Save{dirtyRows.length > 0 ? ` (${dirtyRows.length})` : ''}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        {TABS.map((tab) => {
          const count =
            tab.id === 'All'
              ? rows.length
              : rows.filter((r) => (tabStatus[tab.id] || []).includes(r.status)).length;
          return (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'}
              onClick={() => changeTab(tab.id)}
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
              <Input
                className="h-9"
                value={bulkTracking}
                onChange={(e) => setBulkTracking(e.target.value)}
                placeholder="e.g. DLV7781234501"
              />
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs text-muted-foreground">Courier</label>
              <Select className="h-9" value={bulkCourier} onChange={(e) => setBulkCourier(e.target.value)}>
                <option value="">Select courier</option>
                {COURIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={applyBulkTracking}>
              Apply to {selectedIds.length} selected
            </Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])}>
              Clear
            </Button>
          </div>
        </VendorBulkBar>
      )}

      {visibleRows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
          title="No orders here"
          description={`You have no orders in "${activeTab}".`}
        />
      ) : (
        <VendorSheet>
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 px-2 w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 align-middle"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select all orders"
                />
              </TableHead>
              <TableHead className="h-9 px-2">Date</TableHead>
              <TableHead className="h-9 px-2">Order ID</TableHead>
              <TableHead className="h-9 px-2">Photo</TableHead>
              <TableHead className="h-9 px-2">Cost</TableHead>
              <TableHead className="h-9 px-2 w-40">Dispatch Date</TableHead>
              <TableHead className="h-9 px-2 w-40">Date of Delivery</TableHead>
              <TableHead className="h-9 px-2 w-48">Tracking ID</TableHead>
              <TableHead className="h-9 px-2 w-48">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id} className={isDirty(row) ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''}>
                <TableCell className="p-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 align-middle"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`Select order ${row.orderId}`}
                  />
                </TableCell>
                <TableCell className="p-2 whitespace-nowrap">{formatDate(row.assignedDate)}</TableCell>
                <TableCell className="p-2 font-medium whitespace-nowrap">
                  {row.orderId}
                  <div className="text-xs text-muted-foreground">{row.product}</div>
                </TableCell>
                <TableCell className="p-2">
                  <ProductThumb name={row.product} />
                </TableCell>
                <TableCell className="p-1 w-28">
                  <Input
                    className="h-9"
                    type="number"
                    value={row.assignPrice}
                    onChange={(e) => updateCell(row.id, 'assignPrice', Number(e.target.value))}
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    className="h-9"
                    type="date"
                    value={row.dispatchedDate || ''}
                    onChange={(e) => updateCell(row.id, 'dispatchedDate', e.target.value)}
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    className="h-9"
                    type="date"
                    value={row.deliveryDate || ''}
                    onChange={(e) => updateCell(row.id, 'deliveryDate', e.target.value)}
                  />
                </TableCell>
                <TableCell className="p-1">
                  <Input
                    className="h-9"
                    value={row.trackingNumber}
                    onChange={(e) => updateCell(row.id, 'trackingNumber', e.target.value)}
                    placeholder="Tracking ID"
                  />
                </TableCell>
                <TableCell className="p-2">
                  {row.status === 'Pending Acceptance' ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => respond(row.id, 'Accepted')}>
                        <Check className="h-4 w-4 mr-1" />
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => respond(row.id, 'Rejected')}>
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline">{row.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </VendorSheet>
      )}
    </VendorPage>
  );
}

