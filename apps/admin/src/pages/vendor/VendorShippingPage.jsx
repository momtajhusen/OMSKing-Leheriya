import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendorOrders } from '../../mocks';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import EmptyState from '../../components/ui/EmptyState';
import { VendorPage, VendorBulkBar, VendorSheet } from '../../components/vendor/VendorChrome';
import { Printer, Truck, MapPin, PackageCheck } from 'lucide-react';

const COURIERS = ['Delhivery', 'Bluedart', 'Ecom Express', 'Xpressbees', 'Other'];

const today = () => new Date().toISOString().slice(0, 10);

export default function VendorShippingPage() {
  const [rows, setRows] = useState(vendorOrders);
  const [activeTab, setActiveTab] = useState('ready');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkTracking, setBulkTracking] = useState('');
  const [bulkCourier, setBulkCourier] = useState('');

  const readyRows = rows.filter((r) => r.status === 'Ready to Dispatch');
  const dispatchedRows = rows.filter((r) => r.status === 'Dispatched' || r.status === 'Delivered');
  const allReadySelected = readyRows.length > 0 && readyRows.every((r) => selectedIds.includes(r.id));

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

  const toggleAllReady = () => {
    setSelectedIds(allReadySelected ? [] : readyRows.map((r) => r.id));
  };

  const printLabel = (row) => {
    console.log('[Vendor] Print label', { id: row.id, orderId: row.orderId });
    toast.success(`Label sent to printer for ${row.orderId}`);
  };

  const markDispatched = (row) => {
    if (!row.trackingNumber.trim()) {
      toast.error('Add a tracking number before dispatching');
      return;
    }
    console.log('[Vendor] Mark dispatched', { id: row.id, trackingNumber: row.trackingNumber });
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, status: 'Dispatched', dispatchedDate: today() } : r
      )
    );
    setSelectedIds((prev) => prev.filter((x) => x !== row.id));
    toast.success(`${row.orderId} marked dispatched`);
  };

  // Several orders in one parcel share a single AWB
  const dispatchSelectedTogether = () => {
    if (!bulkTracking.trim()) {
      toast.error('Enter the tracking number for this parcel');
      return;
    }
    if (!bulkCourier) {
      toast.error('Pick the courier for this parcel');
      return;
    }
    console.log('[Vendor] Bulk dispatch under one AWB', {
      ids: selectedIds,
      trackingNumber: bulkTracking.trim(),
      courier: bulkCourier,
    });
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.includes(r.id)
          ? {
              ...r,
              trackingNumber: bulkTracking.trim(),
              courier: bulkCourier,
              status: 'Dispatched',
              dispatchedDate: today(),
            }
          : r
      )
    );
    toast.success(`${selectedIds.length} orders dispatched under one tracking number`);
    setSelectedIds([]);
    setBulkTracking('');
    setBulkCourier('');
  };

  const trackShipment = (row) => {
    console.log('[Vendor] Track shipment', { trackingNumber: row.trackingNumber, courier: row.courier });
    toast.success(`Tracking ${row.trackingNumber} with ${row.courier}`);
  };

  return (
    <VendorPage
      title="Shipping"
      subtitle="Print labels and send parcels. Tick several lines for one AWB."
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={activeTab === 'ready' ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'}
          onClick={() => changeTab('ready')}
        >
          Ready to Dispatch ({readyRows.length})
        </button>
        <button
          type="button"
          className={activeTab === 'dispatched' ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'}
          onClick={() => changeTab('dispatched')}
        >
          Dispatched ({dispatchedRows.length})
        </button>
      </div>

      {activeTab === 'ready' && (
        <>
          {selectedIds.length > 0 && (
            <VendorBulkBar>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
                  <Truck className="h-4 w-4" />
                  One parcel, one tracking number
                </div>
                <div className="w-56">
                  <label className="block text-xs text-muted-foreground mb-1">Tracking Number</label>
                  <Input
                    className="h-9"
                    value={bulkTracking}
                    onChange={(e) => setBulkTracking(e.target.value)}
                    placeholder="e.g. DLV7781234501"
                  />
                </div>
                <div className="w-44">
                  <label className="block text-xs text-muted-foreground mb-1">Courier</label>
                  <Select className="h-9" value={bulkCourier} onChange={(e) => setBulkCourier(e.target.value)}>
                    <option value="">Select courier</option>
                    {COURIERS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button onClick={dispatchSelectedTogether}>
                  Dispatch {selectedIds.length} selected {selectedIds.length === 1 ? 'order' : 'orders'}
                </Button>
                <Button variant="ghost" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
              </div>
            </VendorBulkBar>
          )}

          {readyRows.length === 0 ? (
            <EmptyState
              icon={<PackageCheck className="h-6 w-6 text-muted-foreground" />}
              title="Nothing ready to dispatch"
              description="Orders show up here once you mark them ready in My Orders."
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
                      checked={allReadySelected}
                      onChange={toggleAllReady}
                      aria-label="Select all ready orders"
                    />
                  </TableHead>
                  <TableHead className="h-9 px-2">Order ID</TableHead>
                  <TableHead className="h-9 px-2">Product</TableHead>
                  <TableHead className="h-9 px-2">SKU</TableHead>
                  <TableHead className="h-9 px-2">Qty</TableHead>
                  <TableHead className="h-9 px-2">City</TableHead>
                  <TableHead className="h-9 px-2">Due Date</TableHead>
                  <TableHead className="h-9 px-2 w-48">Tracking Number</TableHead>
                  <TableHead className="h-9 px-2 w-40">Courier</TableHead>
                  <TableHead className="h-9 px-2 w-56">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readyRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="p-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 align-middle"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select order ${row.orderId}`}
                      />
                    </TableCell>
                    <TableCell className="p-2 font-medium whitespace-nowrap">{row.orderId}</TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{row.product}</TableCell>
                    <TableCell className="p-2 font-mono text-xs whitespace-nowrap">{row.sku}</TableCell>
                    <TableCell className="p-2">{row.qty}</TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{row.customerCity}</TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{formatDate(row.dueDate)}</TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="h-9"
                        value={row.trackingNumber}
                        onChange={(e) => updateCell(row.id, 'trackingNumber', e.target.value)}
                        placeholder="Type AWB"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Select
                        className="h-9"
                        value={row.courier}
                        onChange={(e) => updateCell(row.id, 'courier', e.target.value)}
                      >
                        <option value="">—</option>
                        {COURIERS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="p-2">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => printLabel(row)}>
                          <Printer className="h-4 w-4 mr-1" />
                          Print Label
                        </Button>
                        <Button size="sm" onClick={() => markDispatched(row)}>
                          <Truck className="h-4 w-4 mr-1" />
                          Mark Dispatched
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </VendorSheet>
          )}
        </>
      )}

      {activeTab === 'dispatched' && (
        <>
          {dispatchedRows.length === 0 ? (
            <EmptyState
              icon={<Truck className="h-6 w-6 text-muted-foreground" />}
              title="Nothing dispatched yet"
              description="Parcels you send out will be listed here."
            />
          ) : (
            <VendorSheet>
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 px-2">Order ID</TableHead>
                  <TableHead className="h-9 px-2">AWB</TableHead>
                  <TableHead className="h-9 px-2">Courier</TableHead>
                  <TableHead className="h-9 px-2">Dispatched Date</TableHead>
                  <TableHead className="h-9 px-2">Status</TableHead>
                  <TableHead className="h-9 px-2">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatchedRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="p-2 font-medium whitespace-nowrap">{row.orderId}</TableCell>
                    <TableCell className="p-2 font-mono text-xs whitespace-nowrap">
                      {row.trackingNumber || '—'}
                    </TableCell>
                    <TableCell className="p-2 whitespace-nowrap">{row.courier || '—'}</TableCell>
                    <TableCell className="p-2 whitespace-nowrap">
                      {row.dispatchedDate ? formatDate(row.dispatchedDate) : '—'}
                    </TableCell>
                    <TableCell className="p-2">
                      <Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className="p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!row.trackingNumber}
                        onClick={() => trackShipment(row)}
                      >
                        <MapPin className="h-4 w-4 mr-1" />
                        Track
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </VendorSheet>
          )}
        </>
      )}
    </VendorPage>
  );
}
