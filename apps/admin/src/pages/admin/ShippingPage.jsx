import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { orders, shipments as shipmentSeed } from '../../mocks';
import { formatINR, formatDate, formatDateTime } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Drawer from '../../components/ui/Drawer';
import Modal from '../../components/ui/Modal';
import { Truck, Package, Download, RefreshCw, CheckCircle, Clock, AlertTriangle, MapPin } from 'lucide-react';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'Label Pending', label: 'Label Pending' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'manifest', label: 'Manifest' },
];

const COURIERS = [
  { id: 'delhivery', name: 'Delhivery', logo: '🚚', price: 85, eta: '2-3 days', recommended: true, service: 'Surface' },
  { id: 'bluedart', name: 'Bluedart', logo: '✈️', price: 120, eta: '1-2 days', recommended: false, service: 'Air' },
  { id: 'ecom', name: 'Ecom Express', logo: '📦', price: 95, eta: '2-4 days', recommended: false, service: 'Surface' },
  { id: 'xpressbees', name: 'Xpressbees', logo: '🐝', price: 78, eta: '3-4 days', recommended: false, service: 'Surface' },
];

export default function ShippingPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [shipmentList, setShipmentList] = useState(shipmentSeed);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [labelFor, setLabelFor] = useState(null);
  const [trackItem, setTrackItem] = useState(null);
  const [cancelItem, setCancelItem] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [pincode, setPincode] = useState('302001');
  const [selectedIds, setSelectedIds] = useState({});
  const loading = useSimulatedLoad(activeTab);

  const filtered = useMemo(() => shipmentList.filter((shipment) => {
    if (activeTab === 'all' || activeTab === 'manifest') return true;
    if (activeTab === 'exceptions') return ['Exception', 'RTO In Transit'].includes(shipment.status);
    return shipment.status === activeTab;
  }), [shipmentList, activeTab]);

  const kpiData = {
    labelPending: shipmentList.filter((s) => s.status === 'Label Pending').length,
    inTransit: shipmentList.filter((s) => s.status === 'In Transit').length,
    delivered: shipmentList.filter((s) => s.status === 'Delivered').length,
    exceptions: shipmentList.filter((s) => ['Exception', 'RTO In Transit'].includes(s.status)).length,
  };

  const generateLabel = (courierId) => {
    const courier = COURIERS.find((item) => item.id === courierId);
    if (!labelFor || !courier) return;
    setShipmentList((prev) => prev.map((item) => (
      item.id === labelFor.id
        ? {
            ...item,
            courier: courier.name,
            awb: `${courier.name.slice(0, 3).toUpperCase()}${Date.now().toString().slice(-8)}`,
            status: 'In Transit',
            shippedDate: new Date().toISOString(),
            trackingEvents: [{ status: 'Label Generated', date: new Date().toISOString(), location: 'Jaipur' }],
          }
        : item
    )));
    toast.success(`Label generated with ${courier.name}`);
    setLabelFor(null);
    setSelectedOrder(null);
  };

  const cancelLabel = () => {
    if (!cancelItem) return;
    setShipmentList((prev) => prev.map((item) => (
      item.id === cancelItem.id
        ? { ...item, awb: '', status: 'Label Pending', trackingEvents: [] }
        : item
    )));
    toast.success(`${cancelItem.orderId} reverted to Unfulfilled and synced to Shopify`);
    setCancelItem(null);
  };

  const syncShipments = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success('Shipment statuses synced from couriers');
    }, 700);
  };

  if (loading) return <PageLoader label="Loading shipping..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Shipping</h1>
          <p className="text-muted-foreground">Labels, AWB, manifests. Cancel a label and Shopify goes back to unfulfilled.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
              if (!ids.length) {
                toast.error('Select Shopify shipments without AWB');
                return;
              }
              toast.success(`Bulk labels queued for ${ids.length} shipments`);
            }}
          >
            Bulk labels
          </Button>
          <Button variant="outline" onClick={() => toast.success('Shipping manifest downloaded')}>
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
        <KpiCard label="Label Pending" value={kpiData.labelPending} icon={Package} onClick={() => setActiveTab('Label Pending')} />
        <KpiCard label="In Transit" value={kpiData.inTransit} icon={Truck} onClick={() => setActiveTab('In Transit')} />
        <KpiCard label="Delivered" value={kpiData.delivered} icon={CheckCircle} onClick={() => setActiveTab('Delivered')} />
        <KpiCard label="Exceptions / RTO" value={kpiData.exceptions} icon={AlertTriangle} onClick={() => setActiveTab('exceptions')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Pincode serviceability</CardTitle>
          <CardDescription>Rate card check before AWB. Dummy: 3xxx and 4xxx = serviceable.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Pincode</label>
            <input
              className="mt-1 block w-36 rounded-md border bg-background px-3 py-2 text-sm"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
            />
          </div>
          <Button
            onClick={() => {
              const ok = /^[34]\d{5}$/.test(pincode);
              toast[ok ? 'success' : 'error'](ok ? `${pincode} serviceable (Delhivery Surface ₹85)` : `${pincode} not serviceable on current couriers`);
            }}
          >
            Check
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((tab) => (
          <Button key={tab.id} variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {labelFor && selectedOrder && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle>Courier Rate Comparison</CardTitle>
            <CardDescription>
              Order: {selectedOrder.id} | Weight: 0.5kg | Destination: {selectedOrder.city}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {COURIERS.map((courier) => (
                <Card key={courier.id} className={courier.recommended ? 'border-primary bg-primary/5' : ''}>
                  <CardContent className="pt-6 text-center">
                    <div className="text-4xl mb-2">{courier.logo}</div>
                    <h3 className="font-bold text-lg mb-1">{courier.name}</h3>
                    <p className="text-sm text-muted-foreground mb-3">{courier.service}</p>
                    <div className="text-2xl font-bold mb-1">{formatINR(courier.price)}</div>
                    <p className="text-sm text-muted-foreground mb-3">ETA: {courier.eta}</p>
                    {courier.recommended && <Badge className="mb-3">Recommended</Badge>}
                    <Button className="w-full" size="sm" onClick={() => generateLabel(courier.id)}>
                      Ship with {courier.name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button variant="outline" onClick={() => { setLabelFor(null); setSelectedOrder(null); }}>Cancel</Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'manifest' && (
        <Card>
          <CardHeader>
            <CardTitle>Close manifest & pickup</CardTitle>
            <CardDescription>End-of-day handover. Pickup request after labels exist.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => toast.success('Manifest MF-TODAY closed')}>Close manifest</Button>
            <Button variant="outline" onClick={() => toast.success('Pickup scheduled with Delhivery')}>Schedule pickup</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Shipments Queue ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No shipments in this tab" description="Try another status or sync shipments." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>AWB Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((shipment) => {
                  const order = orders.find((o) => o.id === shipment.orderId);
                  return (
                    <TableRow key={shipment.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedIds[shipment.id])}
                          onChange={() => setSelectedIds((prev) => ({ ...prev, [shipment.id]: !prev[shipment.id] }))}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{shipment.orderId}</TableCell>
                      <TableCell>{order?.customer || 'N/A'}</TableCell>
                      <TableCell>
                        {order?.channel === 'Amazon' || order?.channel === 'Myntra' ? (
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Marketplace Courier
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{order?.channel || 'N/A'}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{shipment.courier || '—'}</TableCell>
                      <TableCell className="font-mono">{shipment.awb || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={
                          shipment.status === 'Delivered' ? 'outline' :
                          shipment.status === 'In Transit' ? 'default' :
                          ['Exception', 'RTO In Transit'].includes(shipment.status) ? 'destructive' :
                          'secondary'
                        }>
                          {shipment.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-sm">
                            {shipment.estimatedDelivery ? formatDate(shipment.estimatedDelivery) : '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {!shipment.awb && order?.channel === 'Shopify' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedOrder(order);
                                setLabelFor(shipment);
                              }}
                            >
                              Generate Label
                            </Button>
                          )}
                          {shipment.awb && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => setTrackItem(shipment)}>Track</Button>
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelItem(shipment)}>
                                Cancel Label
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Drawer open={!!trackItem} onOpenChange={(open) => !open && setTrackItem(null)} title={trackItem ? `Track ${trackItem.awb}` : 'Track'}>
        {trackItem && (
          <div className="space-y-4">
            <div className="text-sm">
              <p className="font-medium">{trackItem.orderId} · {trackItem.courier}</p>
              <p className="text-muted-foreground">{trackItem.status}</p>
            </div>
            {(trackItem.trackingEvents || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No tracking events yet.</p>
            ) : (
              <div className="space-y-3">
                {trackItem.trackingEvents.map((event, index) => (
                  <div key={`${event.status}-${index}`} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                    <div>
                      <p className="text-sm font-medium">{event.status}</p>
                      <p className="text-xs text-muted-foreground">{event.location} · {formatDateTime(event.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!cancelItem}
        onOpenChange={(open) => !open && setCancelItem(null)}
        title="Cancel label?"
        description="This reverts the order to Unfulfilled and syncs that status back to Shopify."
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelItem(null)}>Keep label</Button>
            <Button variant="destructive" onClick={cancelLabel}>Cancel label</Button>
          </>
        }
      />
    </div>
  );
}
