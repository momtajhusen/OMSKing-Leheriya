import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { formatDate, formatDateTime, statusBadgeVariant } from '../../utils/format';
import { isChannelManaged, packetIdOf, openMyntraDocument, openAmazonLabel } from '../../lib/channelOrders';
import { canHandOver, manifestPrintHtml, pickupSlotText, shipmentMatchesCourier, shipmentStatus, splitLabelOrders, trackingOf } from '../../lib/shippingStatus';
import { downloadCsv } from '../../lib/orderMetrics';
import { openPrintHtml } from '../../lib/orderPrint';
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
import { Truck, Package, PackageCheck, Download, RefreshCw, CheckCircle, AlertTriangle, CheckCircle2, RotateCcw, Printer, CalendarClock } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import Pagination, { useClientPage } from '../../components/ui/Pagination';
import { toggleId, togglePage } from '../../lib/bulkOrderActions';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'Label Pending', label: 'Label Pending' },
  { id: 'Label generated', label: 'Label generated' },
  { id: 'Ready', label: 'Ready to hand over' },
  { id: 'pickup', label: 'Pickup & Manifest' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'RTO', label: 'RTO' },
];

const OPEN = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];

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
  const amazonLabels = useOrderStore((s) => s.amazonLabels);
  const closeManifest = useOrderStore((s) => s.closeManifest);
  const setOrderStatus = useOrderStore((s) => s.setStatus);
  const bookReversePickup = useOrderStore((s) => s.bookReversePickup);
  const [reverseFor, setReverseFor] = useState(null);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [reverseAwb, setReverseAwb] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [labelFor, setLabelFor] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [alertSeen, setAlertSeen] = useState('');
  const [courierCode, setCourierCode] = useState('delhivery');
  const [courierFilter, setCourierFilter] = useState('all');
  const [awb, setAwb] = useState('');
  const [manifests, setManifests] = useState([]);
  const [manifestsLoading, setManifestsLoading] = useState(false);
  const bookingCouriers = readiness?.couriers?.length ? readiness.couriers : [{ code: 'delhivery', name: 'Delhivery', api: true }];
  const picked = bookingCouriers.find((courier) => courier.code === courierCode) || bookingCouriers[0];

  const loadManifests = async () => {
    setManifestsLoading(true);
    try {
      const { data } = await api.get('/orders/handover-manifests?limit=100');
      setManifests(data.data || []);
    } catch {
      setManifests([]);
    } finally {
      setManifestsLoading(false);
    }
  };

  useEffect(() => {
    hydrateFromApi();
    api.get('/orders/shipping-readiness').then(({ data }) => setReadiness(data.data || null)).catch(() => setReadiness(null));
  }, [hydrateFromApi]);

  useEffect(() => {
    if (activeTab === 'pickup') loadManifests();
  }, [activeTab]);

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

  const filtered = useMemo(() => {
    if (activeTab === 'pickup') return [];
    return shipments.filter((row) => {
      if (!shipmentMatchesCourier(row, courierFilter)) return false;
      if (activeTab === 'all') return true;
      if (activeTab === 'exceptions') return row.shipStatus === 'Exception';
      return row.shipStatus === activeTab;
    });
  }, [shipments, activeTab, courierFilter]);
  const paged = useClientPage(filtered);
  const pickupManifests = useMemo(() => {
    if (courierFilter === 'all') return manifests;
    return manifests.filter((row) => shipmentMatchesCourier({ courier: row.courier }, courierFilter));
  }, [manifests, courierFilter]);
  const waitingPickupCount = useMemo(
    () => manifests.filter((row) => !row.pickupId).length,
    [manifests],
  );
  const courierHistoryCount = (code) => shipments.filter((row) => shipmentMatchesCourier(row, code)).length;

  const scoped = useMemo(
    () => shipments.filter((row) => shipmentMatchesCourier(row, courierFilter)),
    [shipments, courierFilter],
  );
  const count = (status) => scoped.filter((row) => row.shipStatus === status).length;

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
    else if (order.channel === 'Amazon') toast.success(`${order.id} Amazon label cancelled. The next label moves the same Amazon package to a new pickup slot.`, { duration: 8000 });
    else toast.success(`${order.id} label cancelled. Order is back to New.`);
  };

  const markDispatched = async (order) => {
    setBusy(order.id);
    const next = await setOrderStatus(order.id, 'Dispatched');
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${order.id} handed to ${order.courier || 'courier'}`);
  };

  const sendToReady = async (order) => {
    setBusy(order.id);
    try {
      const { data } = await api.post('/orders/handover', { orderIds: [order.id] });
      const result = data.data || {};
      await hydrateFromApi();
      const names = (result.manifests || []).map((row) => row.manifestNo).join(', ');
      toast.success(
        `${order.channelOrderNo || order.id} is Ready to hand over${names ? ` (${names})` : ''}. Courier is not notified yet — Schedule Pickup on Pickup & Manifest.`,
      );
      if (names) setActiveTab('pickup');
    } catch (err) {
      toast.error(apiError(err, 'Could not move to Ready to hand over'));
    } finally {
      setBusy('');
    }
  };

  const printHandoverManifest = async (manifestNo) => {
    const { data } = await api.get(`/orders/handover-manifests/${encodeURIComponent(manifestNo)}`);
    openPrintHtml(manifestPrintHtml(data.data), `${manifestNo || 'manifest'}.html`);
  };

  const scheduleManifestPickup = async (manifestNo) => {
    setBusy(manifestNo);
    try {
      const { data } = await api.post(`/orders/handover-manifests/${encodeURIComponent(manifestNo)}/pickup`);
      const manifest = data.data;
      await hydrateFromApi();
      await loadManifests();
      openPrintHtml(manifestPrintHtml(manifest), `${manifest.manifestNo || 'manifest'}.html`);
      toast.success(
        data.message || `Pickup ${manifest.pickupId} sent to ${manifest.courier}. Courier is notified — printing manifest.`,
      );
    } catch (err) {
      toast.error(apiError(err, 'Could not schedule pickup — courier was not notified'));
    } finally {
      setBusy('');
    }
  };

  const generateManifestPickup = async (order) => {
    if (!order.manifestNo) {
      toast.error('Move this parcel to Ready to hand over first');
      return;
    }
    await scheduleManifestPickup(order.manifestNo);
  };

  const printRowManifest = async (order) => {
    if (!order.manifestNo) {
      toast.error('No handover manifest on this parcel yet');
      return;
    }
    setBusy(order.id);
    try {
      await printHandoverManifest(order.manifestNo);
    } catch (err) {
      toast.error(apiError(err, 'Could not print the manifest'));
    } finally {
      setBusy('');
    }
  };

  const printAmazonLabel = async (order) => {
    setBusy(order.id);
    try {
      await openAmazonLabel(order);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
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

  const canLabel = (row) => row.shipStatus === 'Label Pending' && (!row.marketplace || row.channel === 'Amazon');
  const pendingLabels = shipments.filter(canLabel);
  const selectableIds = useMemo(
    () => filtered.filter((row) => canLabel(row) || canHandOver(row)).map((row) => row.id),
    [filtered],
  );
  const allSelectableTicked = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));
  const someSelectableTicked = selectableIds.some((id) => selectedIds.includes(id));

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

  const handoverIds = shipments.filter((row) => canHandOver(row) && selectedIds.includes(row.id)).map((row) => row.id);

  const handOver = async () => {
    if (!handoverIds.length) {
      toast.error('Select parcels in Label generated to hand over');
      return;
    }
    setBusy('handover');
    try {
      const { data } = await api.post('/orders/handover', { orderIds: handoverIds });
      const result = data.data || {};
      setSelectedIds((prev) => prev.filter((id) => !handoverIds.includes(id)));
      await hydrateFromApi();
      const names = (result.manifests || []).map((row) => row.manifestNo).join(', ');
      toast.success(
        `${data.message}${names ? ` (${names})` : ''}. Courier is not notified yet — open Pickup & Manifest and Schedule Pickup.`,
      );
      setActiveTab('pickup');
      if (result.skipped?.length) toast(`${result.skipped.length} skipped: ${result.skipped.map((row) => `${row.orderNo} (${row.reason})`).join(', ')}`);
    } catch (err) {
      toast.error(apiError(err, 'Could not hand over'));
    } finally {
      setBusy('');
    }
  };

  const downloadManifest = async (manifestNo) => {
    try {
      await printHandoverManifest(manifestNo);
    } catch (err) {
      toast.error(apiError(err, 'Could not print the manifest'));
    }
  };

  const tabCount = (id) => {
    if (id === 'all') return scoped.length;
    if (id === 'exceptions') return count('Exception');
    if (id === 'pickup') return waitingPickupCount || manifests.length;
    return count(id);
  };

  const bookSelected = async () => {
    const { shopify, amazon } = splitLabelOrders(shipments, selectedIds);
    if (!shopify.length && !amazon.length) {
      toast.error('Select Shopify or Amazon orders that still need a label');
      return;
    }
    setBusy('bulk');
    if (shopify.length) {
      const job = await queueLabelJob(shopify);
      if (job?.error) toast.error(job.error);
      else toast.success(`One label job queued for ${shopify.length} Shopify order${shopify.length === 1 ? '' : 's'}`);
    }
    if (amazon.length) {
      const result = await amazonLabels(amazon);
      if (result?.error) toast.error(result.error);
      else {
        toast.success(result.message, { duration: 8000 });
        result.failed.forEach((row) => toast.error(`${row.orderNo}: ${row.reason}`, { duration: 12000 }));
      }
    }
    setBusy('');
    setSelectedIds([]);
  };

  const shipMarketplace = async (order) => {
    setBusy(order.id);
    const next = await shipOnMarketplace(order.id);
    setBusy('');
    if (next?.error) toast.error(next.error);
    else if (order.channel === 'Amazon') {
      toast.success(`${order.id} Easy Ship label ready. AWB ${next.awb}${next.labelReady === false ? ' · Amazon sent no label PDF, print it from Seller Central' : ''}`, { duration: 8000 });
    } else toast.success(`${order.id} tracking saved on ${order.channel}. Delhivery was not used.`);
  };

  if (!loaded) return <PageLoader label="Loading shipping..." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Shipping</h1>
          <p className="text-xs text-muted-foreground">
            Amazon labels come from Easy Ship (Amazon’s courier). Myntra keeps its own courier. Shopify books Delhivery from WH-001 or any other courier enabled for this company.
            {readiness?.missing?.length ? ` Still needed: ${readiness.missing.join(', ')}.` : readiness?.courierReady ? ' Own courier is ready.' : ''}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {can(PERMISSIONS.SHIPPING_GENERATE) && (
            <Button variant="outline" onClick={bookSelected} disabled={busy === 'bulk' || pendingLabels.length === 0}>
              Book selected labels
            </Button>
          )}
          {can(PERMISSIONS.SHIPPING_GENERATE) && (
            <Button variant="outline" onClick={handOver} disabled={busy === 'handover' || handoverIds.length === 0}>
              <PackageCheck className="w-4 h-4 mr-2" />
              Move to Ready to hand over{handoverIds.length ? ` (${handoverIds.length})` : ''}
            </Button>
          )}
                          <Button variant="outline" onClick={exportManifest} disabled={busy === 'manifest'} title="Request Delhivery FM pickup for today's WH-001 AWBs">
            <Download className="w-4 h-4 mr-2" />
            Generate Delhivery pickup
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
        <Button variant={courierFilter === 'all' ? 'default' : 'outline'} size="sm" className="hover:translate-y-0" onClick={() => setCourierFilter('all')}>
          All couriers
          <span className="ml-1.5 tabular-nums opacity-70">{shipments.length}</span>
        </Button>
        {bookingCouriers.map((courier) => (
          <Button
            key={`filter-${courier.code}`}
            variant={courierFilter === courier.code ? 'default' : 'outline'}
            size="sm"
            className="hover:translate-y-0"
            onClick={() => setCourierFilter(courier.code)}
          >
            {courier.name}
            <span className="ml-1.5 tabular-nums opacity-70">{courierHistoryCount(courier.code)}</span>
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((tab) => (
          <Button key={tab.id} variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" className="hover:translate-y-0" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
            <span className="ml-1.5 tabular-nums opacity-70">{tabCount(tab.id)}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {activeTab === 'pickup' ? `Pickup & Manifest (${pickupManifests.length})` : `Shipments (${filtered.length})`}
          </CardTitle>
          <CardDescription>
            {activeTab === 'pickup'
              ? 'Label alone does not message the courier. Schedule Pickup here (Shipway-style) so Delhivery gets the FM request, then Download Manifest.'
              : courierFilter === 'all'
                ? 'Marketplace scans come from the channel. Own-courier scans update when you sync.'
                : `Showing ${bookingCouriers.find((c) => c.code === courierFilter)?.name || courierFilter} only.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeTab === 'pickup' ? (
            manifestsLoading ? (
              <PageLoader label="Loading manifests..." />
            ) : pickupManifests.length === 0 ? (
              <EmptyState
                title="No handover manifests yet"
                description="Move Label generated parcels to Ready to hand over first. Then Schedule Pickup so the courier is notified."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Manifest</TableHead>
                      <TableHead>Orders</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Courier</TableHead>
                      <TableHead>Pickup</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pickupManifests.map((manifest) => {
                      const total = Number(manifest.count) || (manifest.rows || []).length;
                      const scheduled = Boolean(manifest.pickupId);
                      return (
                        <TableRow key={manifest.manifestNo}>
                          <TableCell>
                            <div className="font-mono text-sm font-semibold">{manifest.manifestNo}</div>
                            <div className="text-xs text-muted-foreground">
                              {manifest.createdAt ? formatDateTime(manifest.createdAt) : manifest.day || '—'}
                            </div>
                            <div className="text-xs text-muted-foreground">+{total} order{total === 1 ? '' : 's'}</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={scheduled ? 'default' : 'secondary'}>
                                {scheduled ? `Picked ${total}` : `Picked 0`}
                              </Badge>
                              <Badge variant={scheduled ? 'outline' : 'destructive'}>
                                {scheduled ? 'To be picked 0' : `To be picked ${total}`}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>{manifest.warehouseCode || 'WH-001'}</TableCell>
                          <TableCell>{manifest.courier || '—'}</TableCell>
                          <TableCell>
                            {scheduled ? (
                              <div>
                                <div className="text-sm font-medium text-emerald-700">Pickup scheduled</div>
                                <div className="font-mono text-xs text-muted-foreground">{manifest.pickupId}</div>
                              </div>
                            ) : (
                              <span className="text-sm text-amber-700">Courier not notified yet</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {!scheduled && /delhivery/i.test(manifest.courier || '') && can(PERMISSIONS.SHIPPING_GENERATE) && (
                                <Button
                                  size="sm"
                                  disabled={busy === manifest.manifestNo}
                                  onClick={() => scheduleManifestPickup(manifest.manifestNo)}
                                >
                                  <CalendarClock className="w-3.5 h-3.5 mr-1" />
                                  Schedule Pickup
                                </Button>
                              )}
                              {!scheduled && !/delhivery/i.test(manifest.courier || '') && (
                                <span className="text-xs text-muted-foreground">Schedule on {manifest.courier} portal</span>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === manifest.manifestNo}
                                onClick={() => downloadManifest(manifest.manifestNo)}
                              >
                                <Download className="w-3.5 h-3.5 mr-1" />
                                Download Manifest
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          ) : filtered.length === 0 ? (
            <EmptyState title="No shipments in this tab" description="Try another status or sync shipments." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      {selectableIds.length > 0 && (
                        <input
                          type="checkbox"
                          aria-label="Select all shipments in this list"
                          checked={allSelectableTicked}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelectableTicked && !allSelectableTicked;
                          }}
                          onChange={() => setSelectedIds((prev) => togglePage(prev, selectableIds))}
                        />
                      )}
                    </TableHead>
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
                        {(canLabel(row) || canHandOver(row)) && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.id}`}
                            checked={selectedIds.includes(row.id)}
                            onChange={() => setSelectedIds((prev) => toggleId(prev, row.id))}
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
                        {row.tracking && pickupSlotText(row) && <div className="font-sans text-xs text-muted-foreground">{pickupSlotText(row)}</div>}
                        {row.scan && <div className="font-sans text-xs text-muted-foreground">{row.scan}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={['Exception', 'RTO'].includes(row.shipStatus) ? 'destructive' : statusBadgeVariant(row.status)}>{row.shipStatus}</Badge>
                        {row.manifestNo && (
                          <button
                            type="button"
                            className="mt-1 block font-mono text-[11px] text-primary hover:underline"
                            title="Download this manifest again"
                            onClick={(event) => { event.stopPropagation(); downloadManifest(row.manifestNo); }}
                          >
                            {row.manifestNo}
                          </button>
                        )}
                      </TableCell>
                      <TableCell>{row.createdAt ? formatDate(row.createdAt) : '—'}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          {row.marketplace && !row.tracking && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => shipMarketplace(row)}>
                              {row.channel === 'Amazon' ? 'Easy Ship label' : `Ship on ${row.channel}`}
                            </Button>
                          )}
                          {row.channel === 'Amazon' && row.shipStatus === 'Label generated' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <>
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => printAmazonLabel(row)}>Amazon label</Button>
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => sendToReady(row)}>Ready to hand over</Button>
                              {can(PERMISSIONS.SHIPPING_CANCEL) && (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => cancelOwnLabel(row)}>Cancel label</Button>
                              )}
                            </>
                          )}
                          {row.channel === 'Amazon' && row.shipStatus === 'Ready' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <>
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => printAmazonLabel(row)}>Amazon label</Button>
                              {row.manifestNo && (
                                <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => printRowManifest(row)}>
                                  <Printer className="w-3 h-3 mr-1" />
                                  Print manifest
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => markDispatched(row)}>Mark dispatched</Button>
                            </>
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
                          {!row.marketplace && row.shipStatus === 'Label generated' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <>
                              {/^(Amazon Shipping|Bluedart|Blue Dart|Shree Maruti|Maruti)$/i.test(row.courier || '') ? (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => printAmazonLabel(row)}>Print label</Button>
                              ) : (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => generateLabel(row.id)}>Reprint</Button>
                              )}
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => sendToReady(row)}>
                                Ready to hand over
                              </Button>
                              {can(PERMISSIONS.SHIPPING_CANCEL) && (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => cancelOwnLabel(row)}>Cancel label</Button>
                              )}
                            </>
                          )}
                          {!row.marketplace && row.shipStatus === 'Ready' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <>
                              {/^(Amazon Shipping|Bluedart|Blue Dart|Shree Maruti|Maruti)$/i.test(row.courier || '') ? (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => printAmazonLabel(row)}>Print label</Button>
                              ) : (
                                <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => generateLabel(row.id)}>Reprint</Button>
                              )}
                              {/delhivery/i.test(row.courier || '') && !row.manifestPickupId && (
                                <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => generateManifestPickup(row)}>
                                  Schedule Pickup
                                </Button>
                              )}
                              {(row.manifestPickupId || row.manifestNo) && (
                                <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => printRowManifest(row)}>
                                  <Printer className="w-3 h-3 mr-1" />
                                  Download Manifest
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" disabled={busy === row.id} onClick={() => markDispatched(row)}>Mark dispatched</Button>
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
              ? 'Delhivery is booked by API from WH-001 and the label is stored. Amazon orders use the Easy Ship label button; Myntra orders are not booked here.'
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
                const reverseApi = /delhivery|blue\s*dart|bluedart/i.test(reverseCourier);
                if (!reverseApi && !String(reverseAwb || '').trim()) {
                  toast.error('Enter the reverse AWB from the courier portal so tracking shows on Returns');
                  setBusy('');
                  return;
                }
                const next = await bookReversePickup(reverseFor.id, {
                  reason: reverseReason,
                  courier: reverseCourier,
                  awb: reverseAwb,
                });
                setBusy('');
                if (next?.error) { toast.error(next.error); return; }
                toast.success(`Reverse pickup ${next?.reversePickup?.returnId || ''} is in Returns.`);
                setReverseFor(null);
                setReverseAwb('');
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
          <label className="block text-sm font-medium">
            Reverse AWB{ /delhivery|blue\s*dart|bluedart/i.test(reverseCourier) ? ' (optional)' : '' }
            <Input
              className="mt-1 font-mono"
              value={reverseAwb}
              onChange={(event) => setReverseAwb(event.target.value)}
              placeholder={/delhivery|blue\s*dart|bluedart/i.test(reverseCourier) ? 'Leave blank to book via courier API' : 'AWB from the courier portal'}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              {/delhivery|blue\s*dart|bluedart/i.test(reverseCourier)
                ? 'Delhivery and Bluedart reverse are booked by OMS API from WH-001. Paste an AWB only if you already booked on the portal.'
                : 'Required. OMS does not book this courier reverse by API — paste the AWB from the courier portal.'}
            </span>
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
