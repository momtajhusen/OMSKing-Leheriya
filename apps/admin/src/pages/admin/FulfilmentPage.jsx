import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { orders as orderSeed, vendors } from '../../mocks';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import { Truck, Package, Store, CheckCircle, Bell } from 'lucide-react';

const COMPANY_NOTIFY_NUMBER = '+91 98765 00000';

function vendorLineId(orderId, index) {
  const base = String(orderId).replace(/-LEH$/, '');
  return `${base}-${index + 1}`;
}

function expandVendorLines(orderList) {
  return orderList.flatMap((order) => {
    const lines = [];
    let seq = 0;
    order.items.forEach((item) => {
      const qty = item.qty || 1;
      for (let i = 0; i < qty; i += 1) {
        lines.push({
          key: `${order.id}-${item.sku}-${seq}`,
          vendorOrderId: vendorLineId(order.id, seq),
          masterOrderId: order.id,
          customer: order.customer,
          channel: order.channel,
          status: order.status,
          product: item.name,
          sku: item.sku,
          shopifyVendor: order.shopifyVendor || order.assignedVendor || '',
          shopifyCost: item.cost ?? Math.round((item.price || 0) * 0.5),
          qty: 1,
          split: qty > 1,
        });
        seq += 1;
      }
    });
    return lines;
  });
}

export default function FulfilmentPage() {
  const [activeTab, setActiveTab] = useState('available');
  const [orderList, setOrderList] = useState(orderSeed);
  const [assignments, setAssignments] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [holdOrder, setHoldOrder] = useState(null);
  const [holdVendor, setHoldVendor] = useState('');
  const [rejectLine, setRejectLine] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const loading = useSimulatedLoad(activeTab);

  const openStatuses = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];
  const openOrders = orderList.filter((o) => openStatuses.includes(o.status));
  const directShipOrders = openOrders.filter((o) => o.fulfilmentSource === 'Offline');
  const vendorRoutedOrders = openOrders.filter((o) => o.fulfilmentSource === 'Virtual');
  const onHoldOrders = orderList.filter((o) => o.status === 'Unfulfillable');
  const vendorLines = useMemo(() => expandVendorLines(vendorRoutedOrders), [vendorRoutedOrders]);

  const getAssignment = (line) =>
    assignments[line.key] || {
      vendor: line.shopifyVendor,
      price: String(line.shopifyCost),
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

  const packAndShip = (order) => {
    setBusyKey(order.id);
    setTimeout(() => {
      setOrderList((prev) => prev.map((item) => (
        item.id === order.id ? { ...item, status: 'Ready to Ship' } : item
      )));
      setBusyKey('');
      toast.success(`${order.id} packed from WH-001 Offline`);
    }, 500);
  };

  const assignVendor = (line) => {
    const current = getAssignment(line);
    if (!current.vendor) {
      toast.error('Pick a vendor first');
      return;
    }
    setBusyKey(line.key);
    setTimeout(() => {
      setOrderList((prev) => prev.map((item) => (
        item.id === line.masterOrderId
          ? { ...item, assignedVendor: current.vendor, shopifyVendor: current.vendor, status: 'Processing' }
          : item
      )));
      setBusyKey('');
      toast.success(`${line.vendorOrderId} assigned to ${current.vendor}. Message sent to ${COMPANY_NOTIFY_NUMBER}`);
    }, 450);
  };

  const reassignHold = () => {
    if (!holdVendor || !holdOrder) {
      toast.error('Pick a vendor first');
      return;
    }
    setOrderList((prev) => prev.map((item) => (
      item.id === holdOrder.id
        ? { ...item, status: 'Processing', fulfilmentSource: 'Virtual', assignedVendor: holdVendor, shopifyVendor: holdVendor }
        : item
    )));
    toast.success(`${holdOrder.id} reassigned to ${holdVendor}`);
    setHoldOrder(null);
    setHoldVendor('');
  };

  const tabs = [
    { id: 'available', label: 'Stock Available → Pack & Ship', icon: Package },
    { id: 'unavailable', label: 'Stock Unavailable → Vendor Routing', icon: Store },
    { id: 'onhold', label: 'On Hold', icon: CheckCircle },
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
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell>{order.items.length}</TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant="outline">WH-001 Offline</Badge></TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell>
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
        <Card className="border-blue-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-blue-600" />
              Routed to Vendor (Virtual Stock)
            </CardTitle>
            <CardDescription>
              Vendor and cost come from Shopify. Qty more than 1 is posted as separate vendor
              lines (for example 65234-1, 65234-2). Assigning a vendor also messages the company number.
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
                          {line.vendorOrderId}
                          {line.split && <div className="text-xs text-muted-foreground">split from qty</div>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{line.masterOrderId}</TableCell>
                        <TableCell>
                          <div>{line.product}</div>
                          <div className="text-xs text-muted-foreground">{line.sku}</div>
                        </TableCell>
                        <TableCell className="w-56">
                          <Select className="h-9" value={current.vendor} onChange={(e) => updateAssignment(line.key, 'vendor', e.target.value)}>
                            <option value="">Select vendor</option>
                            {vendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.name}>
                                {vendor.name}
                                {vendor.name === line.shopifyVendor ? ' (Shopify)' : ''}
                              </option>
                            ))}
                          </Select>
                        </TableCell>
                        <TableCell className="w-36">
                          <Input className="h-9" type="number" value={current.price} onChange={(e) => updateAssignment(line.key, 'price', e.target.value)} />
                          <div className="text-[11px] text-muted-foreground mt-1">Shopify cost {formatINR(line.shopifyCost)}</div>
                        </TableCell>
                        <TableCell><Badge variant={statusBadgeVariant(line.status)}>{line.status}</Badge></TableCell>
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
              Unfulfillable orders — no offline stock and no vendor able to supply
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
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {onHoldOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell>{order.items.length}</TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => { setHoldOrder(order); setHoldVendor(order.assignedVendor || ''); }}>
                          Reassign Vendor
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

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Fulfilment Routing</p>
              <p className="text-sm text-muted-foreground">
                Offline stock ships from the warehouse. Virtual stock is posted to the Shopify
                vendor (dropdown can be changed). Qty 2 becomes two vendor lines. On assign,
                a message goes to the company number {COMPANY_NOTIFY_NUMBER}.
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
            <Button onClick={reassignHold}>Assign & notify</Button>
          </>
        }
      >
        <Select value={holdVendor} onChange={(e) => setHoldVendor(e.target.value)}>
          <option value="">Select vendor</option>
          {vendors.map((vendor) => (
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
              onClick={() => {
                if (!rejectReason.trim()) {
                  toast.error('Enter a reason');
                  return;
                }
                toast.success(`${rejectLine.vendorOrderId} rejected: ${rejectReason}`);
                setRejectLine(null);
              }}
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
