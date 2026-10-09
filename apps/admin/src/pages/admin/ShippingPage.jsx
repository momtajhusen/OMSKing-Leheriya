import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { isChannelManaged, packetIdOf, openMyntraDocument } from '../../lib/channelOrders';
import { downloadCsv } from '../../lib/orderMetrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import Modal from '../../components/ui/Modal';
import { Truck, Package, Download, RefreshCw, CheckCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'Label Pending', label: 'Label Pending' },
  { id: 'Ready', label: 'Ready to hand over' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'exceptions', label: 'Exceptions' },
];

const COURIER_NAMES = ['Delhivery', 'Bluedart', 'Xpressbees', 'Ecom Express', 'Shiprocket', 'India Post'];
const OPEN = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

function isRto(order) {
  const codes = `${order.channelStatus || ''} ${(order.channelLines || []).map((line) => line.status).join(' ')}`.toUpperCase();
  return codes.includes('RTO') || Boolean(order.reversePickup?.returnId);
}

function shipmentStatus(order) {
  if (isRto(order)) return 'Exception';
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
  const setOrderStatus = useOrderStore((s) => s.setStatus);
  const [activeTab, setActiveTab] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [labelFor, setLabelFor] = useState(null);
  const [courier, setCourier] = useState(COURIER_NAMES[0]);
  const [awb, setAwb] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const shipments = useMemo(() => orders
    .filter((order) => order.status !== 'Cancelled' && order.status !== 'Unfulfillable')
    .filter((order) => OPEN.includes(order.status) || ['Dispatched', 'Delivered'].includes(order.status))
    .map((order) => ({
      ...order,
      shipStatus: shipmentStatus(order),
      tracking: trackingOf(order),
      marketplace: order.channel === 'Amazon' || order.channel === 'Myntra',
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [orders]);

  const filtered = useMemo(() => shipments.filter((row) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'exceptions') return row.shipStatus === 'Exception';
    return row.shipStatus === activeTab;
  }), [shipments, activeTab]);

  const count = (status) => shipments.filter((row) => row.shipStatus === status).length;

  const syncShipments = async () => {
    setSyncing(true);
    await hydrateFromApi();
    setSyncing(false);
    toast.success('Shipments refreshed from orders');
  };

  const saveLabel = async () => {
    if (!awb.trim()) {
      toast.error('Enter the AWB from the courier booking');
      return;
    }
    setBusy(labelFor.id);
    const next = await generateLabel(labelFor.id, null, { awb: awb.trim(), courier });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(`${next.id} label printed with AWB ${next.awb}`);
    setLabelFor(null);
    setAwb('');
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

  const exportManifest = () => {
    const rows = shipments.filter((row) => row.shipStatus === 'Ready');
    if (!rows.length) {
      toast.error('No labelled shipments waiting for pickup');
      return;
    }
    downloadCsv(`manifest-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Order', 'Channel', 'Courier', 'AWB', 'Customer', 'City', 'Items'],
      rows.map((row) => [row.id, row.channel, row.courier, row.tracking, row.customer, row.city, (row.items || []).reduce((n, item) => n + (item.qty || 1), 0)]));
    toast.success(`Manifest with ${rows.length} shipments downloaded`);
  };

  if (!loaded) return <PageLoader label="Loading shipping..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Shipping</h1>
          <p className="text-muted-foreground">
            Shopify and manual orders: book with your courier, then enter the AWB here to print the label.
            Amazon and Myntra orders use the marketplace courier and label.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={exportManifest}>
            <Download className="w-4 h-4 mr-2" />
            Download Manifest
          </Button>
          <Button variant="outline" onClick={syncShipments} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Shipments'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Label Pending" value={count('Label Pending')} icon={Package} onClick={() => setActiveTab('Label Pending')} />
        <KpiCard label="In Transit" value={count('In Transit')} icon={Truck} onClick={() => setActiveTab('In Transit')} />
        <KpiCard label="Delivered" value={count('Delivered')} icon={CheckCircle} onClick={() => setActiveTab('Delivered')} />
        <KpiCard label="Exceptions / RTO" value={count('Exception')} icon={AlertTriangle} onClick={() => setActiveTab('exceptions')} />
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
          <CardDescription>Built from orders. Courier tracking events are not connected yet.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No shipments in this tab" description="Try another status or sync shipments." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Courier</TableHead>
                    <TableHead>AWB / Tracking</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(row.id)}`)}>
                      <TableCell className="font-medium text-primary">{row.id}</TableCell>
                      <TableCell><ItemThumbs items={row.items} /></TableCell>
                      <TableCell>
                        <div>{row.customer}</div>
                        <div className="text-xs text-muted-foreground">{row.city}</div>
                      </TableCell>
                      <TableCell>
                        {row.marketplace ? (
                          <Badge variant="outline" className="gap-1"><CheckCircle2 className="w-3 h-3" />{row.channel} courier</Badge>
                        ) : (
                          <Badge variant="secondary">{row.channel}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.courier || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.tracking || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={row.shipStatus === 'Exception' ? 'destructive' : statusBadgeVariant(row.status)}>{row.shipStatus}</Badge>
                      </TableCell>
                      <TableCell>{row.createdAt ? formatDate(row.createdAt) : '—'}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          {isChannelManaged(row) && packetIdOf(row) && (
                            <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => openChannelLabel(row)}>
                              {row.channel} label
                            </Button>
                          )}
                          {!row.marketplace && row.shipStatus === 'Label Pending' && can(PERMISSIONS.SHIPPING_GENERATE) && (
                            <Button variant="outline" size="sm" onClick={() => { setLabelFor(row); setCourier(row.courier || COURIER_NAMES[0]); setAwb(''); }}>
                              Enter AWB
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={!!labelFor}
        onOpenChange={(open) => !open && setLabelFor(null)}
        title={labelFor ? `Label for ${labelFor.id}` : 'Label'}
        description="Book the pickup on your courier's panel, then enter the AWB it gives you. The label prints with that AWB."
        footer={
          <>
            <Button variant="outline" onClick={() => setLabelFor(null)}>Cancel</Button>
            <Button loading={busy === labelFor?.id} onClick={saveLabel}>Save & print label</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Courier</label>
            <Select value={courier} onChange={(e) => setCourier(e.target.value)}>
              {COURIER_NAMES.map((name) => <option key={name}>{name}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">AWB number</label>
            <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="From the courier booking" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
