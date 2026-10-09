import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useVendorStore, { vendorReportLabel } from '../../stores/vendorStore';
import useOrderStore from '../../stores/orderStore';
import { isMixedFulfilment } from '../../lib/orderSubOrders';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { isChannelManaged } from '../../lib/channelOrders';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import ProductThumb, { ItemThumbs } from '../../components/ui/ProductThumb';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import { Truck, Package, Store, CheckCircle, Bell, List } from 'lucide-react';

function expandVendorLines(orderList) {
  return orderList.flatMap((order) => {
    const qtyBySku = {};
    (order.items || []).forEach((item) => {
      qtyBySku[item.sku] = (qtyBySku[item.sku] || 0) + (item.qty || 1);
    });
    return (order.subOrders || []).map((sub) => ({
      key: sub.id,
      vendorOrderId: sub.id,
      masterOrderId: order.id,
      customer: order.customer,
      channel: order.channel,
      status: sub.status || order.status,
      product: sub.title,
      sku: sub.sku,
      imageUrl: sub.imageUrl,
      shopifyVendor: sub.assignedVendor || order.shopifyVendor || order.assignedVendor || '',
      shopifyCost: order.items.find((item) => item.sku === sub.sku)?.cost ?? null,
      assignedVendor: sub.assignedVendor || '',
      vendorStatus: sub.vendorStatus || '',
      qty: 1,
      split: (qtyBySku[sub.sku] || 1) > 1,
      address: sub.address || order.address,
    }));
  });
}

export default function FulfilmentPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('available');
  const orderList = useOrderStore((s) => s.orders);
  const setOrderStatus = useOrderStore((s) => s.setStatus);
  const assignSubOrder = useOrderStore((s) => s.assignSubOrder);
  const vendorUpdate = useOrderStore((s) => s.vendorUpdate);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const [assignments, setAssignments] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [holdOrder, setHoldOrder] = useState(null);
  const [holdVendor, setHoldVendor] = useState('');
  const [rejectLine, setRejectLine] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const autoAssign = useVendorStore((s) => s.autoAssign);
  const allVendors = useVendorStore((s) => s.vendors);
  const loadVendors = useVendorStore((s) => s.load);
  const activeVendors = useMemo(() => allVendors.filter((vendor) => !vendor.removed && vendor.status === 'Active'), [allVendors]);
  const loading = !useOrderStore((s) => s.loaded);

  useEffect(() => {
    hydrateFromApi();
    loadVendors();
  }, [hydrateFromApi, loadVendors]);

  const openStatuses = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];
  const openOrders = useMemo(() => orderList.filter((o) => openStatuses.includes(o.status)), [orderList]);
  const directShipOrders = openOrders.filter((o) => !isMixedFulfilment(o) && o.fulfilmentSource === 'Offline');
  const vendorRoutedOrders = openOrders.filter((o) => !isMixedFulfilment(o) && o.fulfilmentSource === 'Virtual');
  const onHoldOrders = orderList.filter((o) => (
    o.status === 'Unfulfillable'
    || ((isMixedFulfilment(o) || o.fulfilmentSource === 'Mixed') && openStatuses.includes(o.status))
  ));
  const vendorLines = useMemo(() => expandVendorLines(vendorRoutedOrders), [vendorRoutedOrders]);
  const activeKey = activeVendors.map((vendor) => vendor.name).join('|');

  useEffect(() => {
    if (!autoAssign) return;
    useOrderStore.getState().orders.forEach((order) => {
      if (order.fulfilmentSource !== 'Virtual') return;
      (order.subOrders || []).forEach((sub) => {
        if (sub.assignedVendor) return;
        const name = vendorReportLabel(order.shopifyVendor);
        if (name === 'Unknown vendor') return;
        const match = activeVendors.find((vendor) => vendor.name === name);
        if (!match) return;
        assignSubOrder(order.id, sub.id, { assignedVendor: match.name });
      });
    });
  }, [autoAssign, activeKey, assignSubOrder, activeVendors]);

  const getAssignment = (line) =>
    assignments[line.key] || {
      vendor: line.shopifyVendor,
      price: line.shopifyCost != null ? String(line.shopifyCost) : '',
    };

  const updateAssignment = (key, field, value) => {
    setAssignments((prev) => ({
      ...prev,
      [key]: {
        vendor: prev[key]?.vendor ?? vendorLines.find((l) => l.key === key)?.shopifyVendor ?? '',
        price: prev[key]?.price ?? String(vendorLines.find((l) => l.key === key)?.shopifyCost ?? ''),
        [field]: value,
      },
    }));
  };

  const packAndShip = async (order) => {
    if (isChannelManaged(order)) {
      toast.error(`${order.id} is a ${order.channel} order. Pack and mark it ready in the ${order.channel} seller panel.`);
      return;
    }
    setBusyKey(order.id);
    const next = await setOrderStatus(order.id, 'Ready to Ship');
    setBusyKey('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${order.id} packed from WH-001 Offline`);
  };

  const assignVendor = async (line) => {
    const current = getAssignment(line);
    if (!current.vendor) {
      toast.error('Pick a vendor first');
      return;
    }
    setBusyKey(line.key);
    const next = await assignSubOrder(line.masterOrderId, line.vendorOrderId, {
      assignedVendor: current.vendor,
      price: current.price === '' ? undefined : current.price,
    });
    setBusyKey('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${line.vendorOrderId} assigned to ${current.vendor}`);
  };

  const reassignHold = async () => {
    if (!holdVendor || !holdOrder) {
      toast.error('Pick a vendor first');
      return;
    }
    for (const sub of holdOrder.subOrders || []) {
      const next = await assignSubOrder(holdOrder.id, sub.id, { assignedVendor: holdVendor });
      if (next?.error) {
        toast.error(next.error);
        return;
      }
    }
    if (holdOrder.status === 'Unfulfillable' && !isChannelManaged(holdOrder)) {
      const next = await setOrderStatus(holdOrder.id, 'Processing');
      if (next?.error) toast.error(next.error);
    }
    toast.success(`${holdOrder.id} assigned to ${holdVendor}`);
    setHoldOrder(null);
    setHoldVendor('');
  };

  const saveReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Enter a reason');
      return;
    }
    if (!rejectLine.assignedVendor) {
      toast.error('Assign a vendor first. Reject is recorded against the vendor on the line.');
      return;
    }
    const next = await vendorUpdate(rejectLine.masterOrderId, rejectLine.vendorOrderId, { action: 'reject', reason: rejectReason });
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(`${rejectLine.vendorOrderId} rejected: ${rejectReason}. Assign another vendor to reroute it.`);
    setRejectLine(null);
  };

  const tabs = [
    { id: 'available', label: 'Stock Available → Pack & Ship', icon: Package },
    { id: 'unavailable', label: 'Stock Unavailable → Vendor Routing', icon: Store },
    { id: 'onhold', label: 'On Hold', icon: CheckCircle },
    { id: 'all', label: 'All Orders', icon: List },
  ];

  if (loading) return <PageLoader label="Loading fulfilment..." />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Fulfilment</h1>
        <p className="text-muted-foreground">Assign vendors on a Master Order. Shopify vendor is pre-filled; qty &gt; 1 can split.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4 mr-2" />
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'available' && (
        <Card className="border-green-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-green-600" />
              Direct Ship (Offline Stock)
            </CardTitle>
            <CardDescription>
              Line items available in the Offline warehouse are packed and shipped from WH-001.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {directShipOrders.length === 0 ? (
              <EmptyState title="No offline orders to pack" description="New warehouse orders will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directShipOrders.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">WH-001 Offline</Badge>
                        {order.routeNote && <div className="text-xs text-muted-foreground mt-1">{order.routeNote}</div>}
                      </TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Button variant="outline" size="sm" disabled={busyKey === order.id} onClick={() => packAndShip(order)}>
                          <Package className="w-4 h-4 mr-1" />
                          {busyKey === order.id ? 'Packing…' : 'Pack & Ship'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'unavailable' && (
        <Card className="border-emerald-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-emerald-600" />
              Routed to Vendor (Virtual Stock)
            </CardTitle>
            <CardDescription>
              Vendor and cost come from Shopify. Qty more than 1 is posted as separate vendor
              lines (for example 65234-1, 65234-2). Only vendors saved on the Vendors page can be assigned.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vendorLines.length === 0 ? (
              <EmptyState title="No vendor lines waiting" description="Virtual-stock orders will split here." />
            ) : (
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor Order ID</TableHead>
                    <TableHead>Master Order</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Assign Vendor</TableHead>
                    <TableHead>Assign Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorLines.map((line) => {
                    const current = getAssignment(line);
                    return (
                      <TableRow key={line.key}>
                        <TableCell className="font-medium whitespace-nowrap">
                          <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/orders/${encodeURIComponent(line.vendorOrderId)}`)}>
                            {line.vendorOrderId}
                          </button>
                          {line.split && <div className="text-xs text-muted-foreground">split from qty</div>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{line.masterOrderId}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ProductThumb name={line.product} src={line.imageUrl} />
                            <div>
                              <div>{line.product}</div>
                              <div className="text-xs text-muted-foreground">{line.sku}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="w-56">
                          <Select className="h-9" value={current.vendor} onChange={(e) => updateAssignment(line.key, 'vendor', e.target.value)}>
                            <option value="">Select vendor</option>
                            {activeVendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.name}>
                                {vendor.name}
                                {vendor.name === line.shopifyVendor ? ' (Shopify)' : ''}
                              </option>
                            ))}
                          </Select>
                          {line.shopifyVendor && !activeVendors.some((vendor) => vendor.name === line.shopifyVendor) && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Shopify: {vendorReportLabel(line.shopifyVendor)}. Removed from the vendor list — pick another.
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="w-36">
                          <Input className="h-9" type="number" value={current.price} onChange={(e) => updateAssignment(line.key, 'price', e.target.value)} />
                          {line.shopifyCost != null && <div className="text-[11px] text-muted-foreground mt-1">Shopify cost {formatINR(line.shopifyCost)}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(line.status)}>{line.status}</Badge>
                          {line.vendorStatus && <div className="mt-1 text-[11px] text-muted-foreground">{line.assignedVendor}: {line.vendorStatus}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" disabled={busyKey === line.key} onClick={() => assignVendor(line)}>
                              <Bell className="w-4 h-4 mr-1" />
                              {busyKey === line.key ? 'Assigning…' : 'Assign'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setRejectLine(line); setRejectReason(''); }}>
                              Reject
                            </Button>
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
      )}

      {activeTab === 'onhold' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-yellow-600" />
              On Hold Orders ({onHoldOrders.length})
            </CardTitle>
            <CardDescription>
              Mixed Offline + Virtual items wait here until both warehouse and vendor lines are assigned. Unmapped SKUs sit here too. Out of stock at WH-001 goes to vendor routing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {onHoldOrders.length === 0 ? (
              <EmptyState icon={<CheckCircle className="h-7 w-7 text-muted-foreground" />} title="No orders currently on hold" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {onHoldOrders.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {(order.items || []).map((item) => (
                            <div key={`${order.id}-${item.sku}`} className="flex items-center gap-2">
                              <ProductThumb name={item.name || item.sku} src={item.imageUrl} />
                              <Badge variant="outline">{item.fulfilmentSource || 'Offline'} · {item.sku}</Badge>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" disabled={busyKey === order.id} onClick={() => packAndShip(order)}>
                            Pack Offline
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setHoldOrder(order); setHoldVendor(order.assignedVendor || ''); }}>
                            Assign vendor
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'all' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <List className="w-5 h-5 text-primary" />
              All Orders ({openOrders.length})
            </CardTitle>
            <CardDescription>
              Pack and send even if the vendor has not posted the order yet. Mixed Offline + Virtual rows also appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {openOrders.length === 0 ? (
              <EmptyState title="No open orders" description="New marketplace orders will appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Fulfil from</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openOrders.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell>
                        <Badge variant="secondary">{isMixedFulfilment(order) ? 'Mixed' : (order.fulfilmentSource || 'Offline')}</Badge>
                      </TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" disabled={busyKey === order.id} onClick={() => packAndShip(order)}>
                            <Package className="w-4 h-4 mr-1" />
                            Pack & Ship
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => { setHoldOrder(order); setHoldVendor(order.assignedVendor || ''); }}>
                            Assign vendor
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Fulfilment Routing</p>
              <p className="text-sm text-muted-foreground">
                Offline stock ships from the warehouse. Virtual stock is posted to the Shopify
                vendor (dropdown can be changed). Qty 2 becomes two vendor lines. The vendor sees
                assigned lines on their portal. Mixed Offline + Virtual orders stay on On Hold. Myntra and Amazon orders are packed in the marketplace panel.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={!!holdOrder}
        onOpenChange={(open) => !open && setHoldOrder(null)}
        title="Reassign vendor"
        description={holdOrder ? `Send ${holdOrder.id} back into vendor routing.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setHoldOrder(null)}>Cancel</Button>
            <Button onClick={reassignHold}>Assign</Button>
          </>
        }
      >
        <Select value={holdVendor} onChange={(e) => setHoldVendor(e.target.value)}>
          <option value="">Select vendor</option>
          {activeVendors.map((vendor) => (
            <option key={vendor.id} value={vendor.name}>{vendor.name}</option>
          ))}
        </Select>
      </Modal>

      <Modal
        open={!!rejectLine}
        onOpenChange={(open) => !open && setRejectLine(null)}
        title="Vendor reject"
        description="Reason is stored; line can be reassigned. Master Order stays one."
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectLine(null)}>Cancel</Button>
            <Button
              onClick={saveReject}
            >
              Save reject
            </Button>
          </>
        }
      >
        <Input placeholder="Out of stock / cannot ship…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>
    </div>
  );
}
