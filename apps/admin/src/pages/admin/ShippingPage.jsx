import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { isChannelManaged, packetIdOf, openMyntraDocument } from '../../lib/channelOrders';
import { downloadCsv } from '../../lib/orderMetrics';
import { paymentModeOf, prepaidLabelledCod } from '../../lib/labelPayment';
import api, { apiError } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Truck, Package, Download, RefreshCw, CheckCircle, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import Pagination, { useClientPage } from '../../components/ui/Pagination';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'Label Pending', label: 'Label Pending' },
  { id: 'Ready', label: 'Ready to hand over' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'RTO', label: 'RTO' },
];

const OPEN = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

function isCourierRto(order) {
  const codes = `${order.channelStatus || ''} ${(order.channelLines || []).map((line) => line.status).join(' ')}`.toUpperCase();
  return codes.includes('RTO');
}

function shipmentStatus(order) {
  if (isCourierRto(order)) return 'RTO';
  if (order.reversePickup?.returnId) return 'Exception';
  if (order.status === 'Delivered') return 'Delivered';
  if (order.status === 'Dispatched') return 'In Transit';
  if (trackingOf(order)) return 'Ready';
  return 'Label Pending';
}

export default function ShippingPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const generateLabel = useOrderStore((s) => s.generateLabel);
  const cancelLabel = useOrderStore((s) => s.cancelLabel);
  const shipOnMarketplace = useOrderStore((s) => s.shipOnMarketplace);
  const queueLabelJob = useOrderStore((s) => s.queueLabelJob);
  const closeManifest = useOrderStore((s) => s.closeManifest);
  const setOrderStatus = useOrderStore((s) => s.setStatus);
  const bookReversePickup = useOrderStore((s) => s.bookReversePickup);
  const [reverseFor, setReverseFor] = useState(null);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [activeTab, setActiveTab] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [labelFor, setLabelFor] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [alertSeen, setAlertSeen] = useState('');
  const [courierCode, setCourierCode] = useState('delhivery');
  const [awb, setAwb] = useState('');
  const bookingCouriers = readiness?.couriers?.length ? readiness.couriers : [{ code: 'delhivery', name: 'Delhivery', api: true }];
  const picked = bookingCouriers.find((courier) => courier.code === courierCode) || bookingCouriers[0];

  useEffect(() => {
    hydrateFromApi();
    api.get('/orders/shipping-readiness').then(({ data }) => setReadiness(data.data || null)).catch(() => setReadiness(null));
  }, [hydrateFromApi]);

  const shipments = useMemo(() => orders
    .filter((order) => order.status !== 'Cancelled' && order.status !== 'Unfulfillable')
    .filter((order) => OPEN.includes(order.status) || ['Dispatched', 'Delivered'].includes(order.status))
    .map((order) => ({
      ...order,
      shipStatus: shipmentStatus(order),
      tracking: trackingOf(order),
      scan: order.trackingScan?.detail || order.trackingScan?.deliveryStatus || '',
      marketplace: order.channel === 'Amazon' || order.channel === 'Myntra',
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [orders]);

  const codMismatch = useMemo(() => shipments.filter(prepaidLabelledCod), [shipments]);
  const mismatchKey = codMismatch.map((row) => row.id).join(',');

  const filtered = useMemo(() => shipments.filter((row) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'exceptions') return row.shipStatus === 'Exception';
    return row.shipStatus === activeTab;
  }), [shipments, activeTab]);
  const paged = useClientPage(filtered);

  const count = (status) => shipments.filter((row) => row.shipStatus === status).length;

  const syncShipments = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/ndr/poll');
      await hydrateFromApi();
      toast.success(data.message || 'Shipments checked');
    } catch (err) {
      await hydrateFromApi();
      toast.error(apiError(err, 'Could not check courier tracking'));
    } finally {
      setSyncing(false);
    }
  };

  const openBooking = (row) => {
    setCourierCode('delhivery');
    setAwb('');
    setLabelFor(row);
  };

  const saveLabel = async () => {
    if (!picked.api && !awb.trim()) {
      toast.error(`Enter the ${picked.name} AWB`);
      return;
    }
    setBusy(labelFor.id);
    const next = await generateLabel(labelFor.id, undefined, picked.api ? {} : { courier: picked.code, awb: awb.trim() });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(`${next.id} booked on ${picked.name}. AWB ${next.awb}`);
    setLabelFor(null);
  };

  const cancelOwnLabel = async (order) => {
    setBusy(order.id);
    const next = await cancelLabel(order.id);
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${order.id} label cancelled. Order is back to New.`);
  };

  const markDispatched = async (order) => {
    setBusy(order.id);
    const next = await setOrderStatus(order.id, 'Dispatched');
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${order.id} handed to ${order.courier || 'courier'}`);
  };

  const openChannelLabel = async (order) => {
    setBusy(order.id);
    try {
      await openMyntraDocument(order, 'label');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const pendingShopify = shipments.filter((row) => !row.marketplace && row.shipStatus === 'Label Pending');

  const exportManifest = async () => {
    setBusy('manifest');
    const manifest = await closeManifest();
    setBusy('');
    if (manifest?.error) {
      toast.error(manifest.error);
      return;
    }
    downloadCsv(`manifest-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Order', 'Courier', 'AWB', 'Warehouse'],
      (manifest.rows || []).map((row) => [row.orderNo, row.courier, row.awb, row.warehouseCode]));
    toast.success(`WH-001 pickup requested for ${manifest.count} AWB${manifest.count === 1 ? '' : 's'}`);
  };

  const bookSelected = async () => {
    const ids = pendingShopify.filter((row) => selectedIds.includes(row.id)).map((row) => row.id);
    if (!ids.length) {
      toast.error('Select Shopify orders that still need a label');
      return;
    }
    setBusy('bulk');
    const job = await queueLabelJob(ids);
    setBusy('');
    if (job?.error) {
      toast.error(job.error);
      return;
    }
    setSelectedIds([]);
    toast.success(`One label job queued for ${ids.length} order${ids.length === 1 ? '' : 's'}`);
  };

  const shipMarketplace = async (order) => {
    setBusy(order.id);
    const next = await shipOnMarketplace(order.id);
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${order.id} tracking saved on ${order.channel}. Delhivery was not used.`);
  };

  if (!loaded) return <PageLoader label="Loading shipping..." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Shipping</h1>
          <p className="text-xs text-muted-foreground">
            Amazon and Myntra keep that channel’s courier. Shopify books Delhivery from WH-001 or any other courier enabled for this company.
            {readiness?.missing?.length ? ` Still needed: ${readiness.missing.join(', ')}.` : readiness?.courierReady ? ' Own courier is ready.' : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {can(PERMISSIONS.SHIPPING_GENERATE) && (
            <Button variant="outline" onClick={bookSelected} disabled={busy === 'bulk' || pendingShopify.length === 0}>
              Book selected labels
            </Button>
          )}
          <Button variant="outline" onClick={exportManifest} disabled={busy === 'manifest'}>
            <Download className="w-4 h-4 mr-2" />
            Download Manifest
          </Button>
          <Button variant="outline" onClick={syncShipments} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Shipments'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Label Pending" value={count('Label Pending')} icon={Package} onClick={() => setActiveTab('Label Pending')} />
        <KpiCard label="In Transit" value={count('In Transit')} icon={Truck} onClick={() => setActiveTab('In Transit')} />
        <KpiCard label="Delivered" value={count('Delivered')} icon={CheckCircle} onClick={() => setActiveTab('Delivered')} />
        <KpiCard label="Exceptions / RTO" value={count('Exception') + count('RTO')} icon={AlertTriangle} onClick={() => setActiveTab('exceptions')} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((tab) => (
          <Button key={tab.id} variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shipments ({filtered.length})</CardTitle>
          <CardDescription>Marketplace scans come from the channel. Own-courier scans update when you sync.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No shipments in this tab" description="Try another status or sync shipments." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Order ID</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Courier</TableHead>
                    <TableHead>AWB / Tracking</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.rows.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(row.id)}`)}>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {!row.marketplace && row.shipStatus === 'Label Pending' && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.id}`}
                            checked={selectedIds.includes(row.id)}
                            onChange={() => setSelectedIds((prev) => (prev.includes(row.id) ? prev.filter((id) => id !== row.id) : [...prev, row.id]))}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="text-primary">{row.channelOrderNo || row.id}</span>
                        {row.channelOrderNo && row.channelOrderNo !== row.id && (
                          <div className="text-[11px] text-muted-foreground">{row.id}</div>
                        )}
                      </TableCell>
                      <TableCell><ItemThumbs items={row.items} /></TableCell>
                      <TableCell>
                        <div>{row.customer}</div>
                        <div className="text-xs text-muted-foreground">{row.city}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentModeOf(row) === 'COD' ? 'secondary' : 'outline'}>{paymentModeOf(row) || '—'}</Badge>
                        {prepaidLabelledCod(row) && (
                          <div className="mt-1"><Badge variant="destructive">Label is COD</Badge></div>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.marketplace ? (
                          <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3" />{row.channel} courier</Badge>
                        ) : (
                          <Badge variant="secondary">{row.channel}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.courier || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>{row.tracking || '—'}</div>
                        {row.scan && <div className="font-sans text-xs text-muted-foreground">{row.scan}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={['Exception', 'RTO'].includes(row.shipStatus) ? 'destructive' : statusBadgeVariant(row.status)}>{row.shipStatus}</Badge>
                      </TableCell>
                      <TableCell>{row.createdAt ? formatDate(row.createdAt) : '—'}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          {row.marketplace && !row.tracking && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => shipMarketplace(row)}>
                              Ship on {row.channel}
                            </Button>
                          )}
                          {isChannelManaged(row) && packetIdOf(row) && (
                            <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => openChannelLabel(row)}>
                              {row.channel} label
                            </Button>
                          )}
                          {!row.marketplace && row.shipStatus === 'Label Pending' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <Button variant="outline" size="sm" onClick={() => openBooking(row)}>
                              Book courier
                            </Button>
                          )}
                          {!row.marketplace && row.shipStatus === 'Ready' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <>
                              <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => generateLabel(row.id)}>Reprint</Button>
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => markDispatched(row)}>Mark dispatched</Button>
                              {can(PERMISSIONS.SHIPPING_CANCEL) && (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => cancelOwnLabel(row)}>Cancel label</Button>
                              )}
                            </>
                          )}
                          {row.shipStatus === 'Delivered' && !isChannelManaged(row) && (can(PERMISSIONS.SHIPPING_GENERATE) || can(PERMISSIONS.ORDERS_EDIT)) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setReverseFor(row);
                                setReverseReason('Customer reverse pickup');
                                setReverseCourier(row.courier || 'Delhivery');
                              }}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Book reverse
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={paged.page} total={paged.total} limit={paged.limit} onPage={paged.setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={!!labelFor}
        onOpenChange={(open) => !open && setLabelFor(null)}
        title={labelFor ? `Label for ${labelFor.id}` : 'Label'}
        description="Choose one of this company's enabled couriers. The tracking number is sent to Shopify."
        footer={
          <>
            <Button variant="outline" onClick={() => setLabelFor(null)}>Cancel</Button>
            <Button loading={busy === labelFor?.id} onClick={saveLabel}>Book {picked.name}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Courier
            <Select className="mt-1" value={picked.code} onChange={(event) => { setCourierCode(event.target.value); setAwb(''); }}>
              {bookingCouriers.map((courier) => (
                <option key={courier.code} value={courier.code}>{courier.name}{courier.api ? '' : ' (enter AWB)'}</option>
              ))}
            </Select>
          </label>
          {!picked.api && (
            <label className="block text-sm font-medium">
              {picked.name} AWB
              <Input className="mt-1" value={awb} onChange={(event) => setAwb(event.target.value)} placeholder={`AWB from the ${picked.name} portal`} />
            </label>
          )}
          <p className="text-sm text-muted-foreground">
            {picked.api
              ? 'Delhivery is booked by API from WH-001 and the label is stored. Amazon and Myntra orders are not booked here.'
              : `Book the shipment on the ${picked.name} portal, then enter its AWB here. Couriers are enabled in Settings › Couriers.`}
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(reverseFor)}
        onOpenChange={(open) => { if (!open) setReverseFor(null); }}
        title="Book reverse pickup"
        description={reverseFor ? `Creates a Returns row for ${reverseFor.channelOrderNo || reverseFor.id} and opens the reverse pickup label.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setReverseFor(null)}>Cancel</Button>
            <Button
              loading={busy === 'reverse'}
              onClick={async () => {
                setBusy('reverse');
                const next = await bookReversePickup(reverseFor.id, { reason: reverseReason, courier: reverseCourier });
                setBusy('');
                if (next?.error) { toast.error(next.error); return; }
                toast.success(`Reverse pickup ${next?.reversePickup?.returnId || ''} is in Returns.`);
                setReverseFor(null);
              }}
            >
              Generate reverse label
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Reason
            <Input className="mt-1" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Courier
            <Select className="mt-1" value={reverseCourier} onChange={(event) => setReverseCourier(event.target.value)}>
              <option>Delhivery</option>
              <option>Bluedart</option>
              <option>Xpressbees</option>
              <option>Ecom Express</option>
            </Select>
          </label>
        </div>
      </Modal>

      <Modal
        open={codMismatch.length > 0 && alertSeen !== mismatchKey}
        onOpenChange={(open) => !open && setAlertSeen(mismatchKey)}
        className="border-4 border-red-600 bg-red-50"
        title={<span className="flex items-center gap-2 text-red-700"><AlertTriangle className="w-6 h-6" />Prepaid order booked as COD</span>}
        description="The courier label says COD, but the customer already paid. Cancel this label and book it again before it is handed over."
        footer={<Button variant="destructive" onClick={() => setAlertSeen(mismatchKey)}>I will fix it</Button>}
      >
        <ul className="space-y-1 text-sm font-semibold text-red-700">
          {codMismatch.map((row) => (
            <li key={row.id}>{row.channelOrderNo || row.id} · AWB {row.tracking || '—'} · {row.customer}</li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
