import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useVendorStore, { vendorReportLabel } from '../../stores/vendorStore';
import useAuthStore from '../../stores/authStore';
import useOrderStore from '../../stores/orderStore';
import { isMixedFulfilment } from '../../lib/orderSubOrders';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { isChannelManaged } from '../../lib/channelOrders';
import Pagination, { useClientPage } from '../../components/ui/Pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import ProductThumb, { ItemThumbs } from '../../components/ui/ProductThumb';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import { Truck, Package, Store, CheckCircle, Bell, List } from 'lucide-react';

function PaymentNote({ order }) {
  if (order.paymentMode === 'Void') {
    return <div className="mt-1 text-xs text-muted-foreground">Void. Not booked as COD.</div>;
  }
  if (order.paymentDetail === 'Partially paid') {
    return <div className="mt-1 text-xs text-muted-foreground">Partially paid, handled as COD</div>;
  }
  return null;
}

function Panel({ title, icon: Icon, tone, description, children }) {
  return (
    <section className="rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))]">
      <div className="border-b border-[hsl(var(--color-border-premium))] px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Icon className={`h-4 w-4 ${tone}`} />
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function VendorLineCard({ line, current, vendors, busy, onVendor, onPrice, onAssign, onReject, onOpen }) {
  return (
    <article className="rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-muted))]/15 p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <ProductThumb name={line.product || line.sku} src={line.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                className="block max-w-full truncate text-left text-sm font-semibold text-primary hover:underline"
                onClick={() => onOpen(line.vendorOrderId)}
              >
                {line.vendorOrderId}
              </button>
              <p className="truncate text-sm">{line.product || line.sku}</p>
              <p className="truncate text-xs text-muted-foreground">
                {line.sku}
                {line.split ? ' · split line' : ''}
                {' · Master '}
                {line.masterOrderId}
              </p>
            </div>
            <Badge variant={statusBadgeVariant(line.status)} className="shrink-0">{line.status}</Badge>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_8.5rem_auto] lg:items-start">
        <div className="min-w-0">
          <Select className="h-9" value={current.vendor} onChange={(e) => onVendor(e.target.value)}>
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.name}>
                {vendor.name}
                {vendor.name === line.shopifyVendor ? ' (Shopify)' : ''}
              </option>
            ))}
          </Select>
          {line.shopifyVendor && !vendors.some((vendor) => vendor.name === line.shopifyVendor) && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Shopify: {vendorReportLabel(line.shopifyVendor)}. Pick another vendor.
            </p>
          )}
        </div>
        <div>
          <Input
            className="h-9"
            type="number"
            placeholder="Price"
            value={current.price}
            onChange={(e) => onPrice(e.target.value)}
          />
          {line.shopifyCost != null && (
            <p className="mt-1 text-[11px] text-muted-foreground">Shopify {formatINR(line.shopifyCost)}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="shrink-0" disabled={busy} onClick={onAssign}>
            <Bell className="mr-1 h-4 w-4" />
            {busy ? 'Assigning…' : 'Assign'}
          </Button>
          <Button size="sm" variant="outline" className="shrink-0" onClick={onReject}>
            Reject
          </Button>
        </div>
      </div>
      {line.vendorStatus && (
        <p className="mt-2 text-xs text-muted-foreground">{line.assignedVendor} · {line.vendorStatus}</p>
      )}
    </article>
  );
}

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
      fulfilmentSource: sub.fulfilmentSource || order.fulfilmentSource || 'Offline',
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
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const autoAssign = useVendorStore((s) => Boolean(tenantId && s.autoAssignByTenant?.[tenantId]));
  const allVendors = useVendorStore((s) => s.vendors);
  const loadVendors = useVendorStore((s) => s.load);
  const activeVendors = useMemo(() => allVendors.filter((vendor) => !vendor.removed && vendor.status === 'Active'), [allVendors]);
  const loading = !useOrderStore((s) => s.loaded);

  useEffect(() => {
    hydrateFromApi();
    loadVendors();
  }, [hydrateFromApi, loadVendors]);

  const openStatuses = ['New', 'Pending', 'Processing', 'Packed', 'Ready to Ship'];
  const openOrders = useMemo(() => orderList.filter((o) => openStatuses.includes(o.status) && o.status !== 'Unfulfillable' && !o.mappingFailed), [orderList]);
  const openPage = useClientPage(openOrders);
  const directShipOrders = openOrders.filter((order) => order.fulfilmentSource === 'Offline' || order.fulfilmentSource === 'Mixed' || isMixedFulfilment(order));
  const directPage = useClientPage(directShipOrders);
  const vendorRoutedOrders = openOrders.filter((o) => o.fulfilmentSource === 'Virtual' || o.fulfilmentSource === 'Mixed' || isMixedFulfilment(o));
  const onHoldOrders = orderList.filter((o) => o.status === 'Unfulfillable' || o.mappingFailed);
  const vendorLines = useMemo(
    () => expandVendorLines(vendorRoutedOrders).filter((line) => line.fulfilmentSource === 'Virtual'),
    [vendorRoutedOrders],
  );
  const vendorPage = useClientPage(vendorLines);
  const holdPage = useClientPage(onHoldOrders);
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
    if (order.mappingFailed || order.status === 'Unfulfillable') {
      toast.error('Map the SKU before this order can be packed.');
      return;
    }
    if (isChannelManaged(order)) {
      toast.error(`${order.id} is a ${order.channel} order. Mark it ready in the ${order.channel} seller panel. Delhivery is not used.`);
      return;
    }
    if (order.fulfilmentSource === 'Virtual' && !isMixedFulfilment(order)) {
      toast.error(`${order.id} has no WH-001 units. Assign it on vendor routing.`);
      return;
    }
    if (order.paymentMode === 'Void') {
      toast.error(`${order.id} is Void. It is not packed or booked as COD.`);
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
    else {
      toast.success(`${line.vendorOrderId} assigned to ${current.vendor}`);
      if (next?.telegram === 'no_bot_token') toast('Save the Telegram bot token on Notifications');
      if (next?.telegram === 'no_chat_id') toast('Add this vendor’s Telegram group chat id');
      if (next?.telegram === 'failed') toast.error('Telegram did not send. The assign is saved. Assign again to retry.');
    }
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
    { id: 'available', label: 'Pack', value: directShipOrders.length, icon: Package, tone: 'emerald' },
    { id: 'unavailable', label: 'Vendor', value: vendorLines.length, icon: Store, tone: 'sky' },
    { id: 'onhold', label: 'On hold', value: onHoldOrders.length, icon: CheckCircle, tone: 'amber' },
    { id: 'all', label: 'Open', value: openOrders.length, icon: List, tone: 'blue' },
  ];

  if (loading) return <PageLoader label="Loading fulfilment..." />;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Fulfilment</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">One marketplace order stays one master order. The oldest open order takes WH-001 first.</p>
      </div>

      <div className="kpi-grid">
        {tabs.map((tab) => (
          <KpiCard
            key={tab.id}
            label={tab.label}
            value={tab.value}
            icon={tab.icon}
            tone={tab.tone}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'ring-2 ring-primary' : ''}
          />
        ))}
      </div>

      {activeTab === 'available' && (
        <Panel
          title="Pack from WH-001"
          icon={Package}
          tone="text-emerald-500"
          description="These units fit in the warehouse. A split order is packed here for the WH-001 slice. Amazon and Myntra stay on their own courier."
        >
            {directShipOrders.length === 0 ? (
              <EmptyState title="No offline orders to pack" description="New warehouse orders will appear here." />
            ) : (
              <>
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
                  {directPage.rows.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">WH-001 Offline</Badge>
                        {order.routeNote && <div className="text-xs text-muted-foreground mt-1">{order.routeNote}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
                        <PaymentNote order={order} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                        <Button variant="outline" size="sm" className="shrink-0" disabled={busyKey === order.id || order.paymentMode === 'Void'} onClick={() => packAndShip(order)}>
                          <Package className="w-4 h-4 mr-1" />
                          {busyKey === order.id ? 'Packing…' : (isChannelManaged(order) ? `${order.channel} courier` : 'Pack & Ship')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={directPage.page} total={directPage.total} limit={directPage.limit} onPage={directPage.setPage} />
              </>
            )}
        </Panel>
      )}

      {activeTab === 'unavailable' && (
        <Panel
          title="Vendor lines"
          icon={Store}
          tone="text-sky-500"
          description="What WH-001 cannot cover, and Shopify virtual stock, is assigned here. Qty above one splits into separate lines. Reject keeps a reason so the line can be assigned again."
        >
            {vendorLines.length === 0 ? (
              <EmptyState title="No vendor lines waiting" description="Virtual-stock orders will split here." />
            ) : (
              <>
              <div className="space-y-3">
                {vendorPage.rows.map((line) => {
                  const current = getAssignment(line);
                  return (
                    <VendorLineCard
                      key={line.key}
                      line={line}
                      current={current}
                      vendors={activeVendors}
                      busy={busyKey === line.key}
                      onVendor={(value) => updateAssignment(line.key, 'vendor', value)}
                      onPrice={(value) => updateAssignment(line.key, 'price', value)}
                      onAssign={() => assignVendor(line)}
                      onReject={() => { setRejectLine(line); setRejectReason(''); }}
                      onOpen={(id) => navigate(`/orders/${encodeURIComponent(id)}`)}
                    />
                  );
                })}
              </div>
              <Pagination page={vendorPage.page} total={vendorPage.total} limit={vendorPage.limit} onPage={vendorPage.setPage} />
              </>
            )}
        </Panel>
      )}

      {activeTab === 'onhold' && (
        <Panel
          title={`On hold (${onHoldOrders.length})`}
          icon={CheckCircle}
          tone="text-amber-500"
          description="An unmapped SKU stays here until it is mapped. Stock that WH-001 cannot cover goes to vendor lines."
        >
            {onHoldOrders.length === 0 ? (
              <EmptyState icon={<CheckCircle className="h-7 w-7 text-muted-foreground" />} title="No orders currently on hold" />
            ) : (
              <>
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
                  {holdPage.rows.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell className="whitespace-nowrap">{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate('/sku-mapping')}>
                          Map SKU
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={holdPage.page} total={holdPage.total} limit={holdPage.limit} onPage={holdPage.setPage} />
              </>
            )}
        </Panel>
      )}

      {activeTab === 'all' && (
        <Panel
          title={`Open orders (${openOrders.length})`}
          icon={List}
          tone="text-primary"
          description="Warehouse units can be packed before the vendor posts. A split stays one master order."
        >
            {openOrders.length === 0 ? (
              <EmptyState title="No open orders" description="New marketplace orders will appear here." />
            ) : (
              <>
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
                  {openPage.rows.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell><ItemThumbs items={order.items} /></TableCell>
                      <TableCell>
                        <Badge variant="secondary">{isMixedFulfilment(order) ? 'Mixed' : (order.fulfilmentSource || 'Offline')}</Badge>
                      </TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
                        <PaymentNote order={order} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="shrink-0" disabled={busyKey === order.id || (order.fulfilmentSource === 'Virtual' && !isMixedFulfilment(order))} onClick={() => packAndShip(order)}>
                            <Package className="w-4 h-4 mr-1" />
                            {isChannelManaged(order) ? `${order.channel}` : 'Pack'}
                          </Button>
                          <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setHoldOrder(order); setHoldVendor(order.assignedVendor || ''); }}>
                            Assign
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={openPage.page} total={openPage.total} limit={openPage.limit} onPage={openPage.setPage} />
              </>
            )}
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['WH-001 first', 'The oldest open order takes warehouse stock.'],
          ['Same order', 'Leftover units and Shopify virtual stock become vendor lines.'],
          ['Map first', 'An unmapped SKU stays on hold until the SKU is mapped.'],
          ['Own courier', 'Amazon and Myntra are not booked on Delhivery.'],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Truck className="h-4 w-4 text-primary" />
              {title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>

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
