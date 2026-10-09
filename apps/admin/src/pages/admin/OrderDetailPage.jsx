import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import useVendorStore from '../../stores/vendorStore';
import { formatINR, formatDate, formatDateTime, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import ProductThumb from '../../components/ui/ProductThumb';
import EmptyState from '../../components/ui/EmptyState';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { FileText, Printer, ArrowLeft, Store, RotateCcw, CheckCircle } from 'lucide-react';
import { isChannelManaged, packetIdOf, openMyntraDocument } from '../../lib/channelOrders';

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const orders = useOrderStore((s) => s.orders);
  const getById = useOrderStore((s) => s.getById);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const generateLabel = useOrderStore((s) => s.generateLabel);
  const generateInvoice = useOrderStore((s) => s.generateInvoice);
  const assignSubOrder = useOrderStore((s) => s.assignSubOrder);
  const markDelivered = useOrderStore((s) => s.markDelivered);
  const bookReversePickup = useOrderStore((s) => s.bookReversePickup);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [reverseAwb, setReverseAwb] = useState('');
  const allVendors = useVendorStore((s) => s.vendors);
  const loadVendors = useVendorStore((s) => s.load);
  const vendors = useMemo(() => allVendors.filter((vendor) => !vendor.removed && vendor.status === 'Active'), [allVendors]);
  const [busy, setBusy] = useState('');

  const loaded = useOrderStore((s) => s.loaded);

  useEffect(() => {
    hydrateFromApi();
    loadVendors();
  }, [hydrateFromApi, loadVendors]);

  const order = useMemo(() => getById(orderId), [getById, orderId, orders]);
  const highlightId = order && order.id !== orderId ? orderId : '';

  if (!order && !loaded) return <div className="p-6 text-sm text-muted-foreground">Loading order…</div>;

  if (!order) {
    return (
      <div className="p-6">
        <EmptyState
          title="Order not found"
          description={`${orderId} is not on this tenant.`}
          action={<Button variant="outline" onClick={() => navigate('/orders')}>Back to orders</Button>}
        />
      </div>
    );
  }

  const runLabel = async (subOrderId) => {
    setBusy(subOrderId || 'label');
    const next = await generateLabel(order.id, subOrderId);
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`Label opened. ${next.id} is ${next.status}.`);
  };

  const runInvoice = async () => {
    setBusy('invoice');
    const next = await generateInvoice(order.id);
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`Invoice ${next.invoiceNo} opened`);
  };

  const channelManaged = isChannelManaged(order);
  const packetId = packetIdOf(order);

  const runChannelDoc = async (type) => {
    setBusy(type);
    try {
      await openMyntraDocument(order, type);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <Breadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: order.id }]} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold">{order.id}</h1>
            <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
            <Badge variant="outline">{order.channel}</Badge>
            <Badge variant="secondary">{order.paymentMode}</Badge>
            {order.paymentDetail === 'Partially paid' && (
              <span className="text-xs text-muted-foreground">Partially paid, handled as COD</span>
            )}
            {order.paymentMode === 'Void' && (
              <span className="text-xs text-muted-foreground">Void. Not booked as COD.</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Master order stays one. Qty &gt; 1 is split as {masterHint(order)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/orders')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            All orders
          </Button>
          {channelManaged && packetId && (
            <>
              <Button variant="outline" disabled={busy === 'invoice' || !order.invoiceNo} onClick={() => runChannelDoc('invoice')}>
                <FileText className="w-4 h-4 mr-2" />
                {busy === 'invoice' ? 'Opening…' : 'Myntra Invoice'}
              </Button>
              <Button disabled={busy === 'label'} onClick={() => runChannelDoc('label')}>
                <Printer className="w-4 h-4 mr-2" />
                {busy === 'label' ? 'Opening…' : 'Myntra Label'}
              </Button>
            </>
          )}
          {can(PERMISSIONS.FINANCE_VIEW) && !channelManaged && (
            <Button variant="outline" disabled={busy === 'invoice'} onClick={runInvoice}>
              <FileText className="w-4 h-4 mr-2" />
              {busy === 'invoice' ? 'Opening…' : 'Generate Invoice'}
            </Button>
          )}
          {(can(PERMISSIONS.SHIPPING_GENERATE) || can(PERMISSIONS.ORDERS_EDIT)) && !channelManaged && (
            <Button disabled={busy === 'label'} onClick={() => runLabel()}>
              <Printer className="w-4 h-4 mr-2" />
              {busy === 'label' ? 'Opening…' : 'Generate Label'}
            </Button>
          )}
          {can(PERMISSIONS.ORDERS_EDIT) && ['Dispatched', 'In transit'].includes(order.status) && !channelManaged && (
            <Button
              variant="outline"
              disabled={busy === 'delivered'}
              onClick={async () => {
                setBusy('delivered');
                const next = await markDelivered(order.id);
                setBusy('');
                if (next?.error) { toast.error(next.error); return; }
                toast.success(`${order.id} marked delivered. Book reverse pickup when you are ready.`);
              }}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Mark delivered
            </Button>
          )}
          {(can(PERMISSIONS.SHIPPING_GENERATE) || can(PERMISSIONS.ORDERS_EDIT)) && order.status === 'Delivered' && !channelManaged && (
            <Button
              variant="outline"
              onClick={() => {
                setReverseReason('Customer reverse pickup');
                setReverseCourier(order.courier || 'Delhivery');
                setReverseOpen(true);
              }}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Book reverse pickup
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Customer & address</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Customer</p>
              <p className="font-medium">{order.customer}</p>
              <p className="text-xs text-muted-foreground">{order.phone}</p>
              <p className="text-xs text-muted-foreground">{order.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Placed</p>
              <p className="font-medium">{formatDateTime(order.createdAt)}</p>
              <p className="text-xs text-muted-foreground mt-2">Fulfil from {order.fulfilmentSource}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Shipping address</p>
              <p>{order.address || order.city}</p>
              {order.address && order.city && <p className="text-xs text-muted-foreground">{order.city}</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Shipment</CardTitle>
            <CardDescription>AWB is stamped when a label is generated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Courier</span><span>{order.courier || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">AWB</span><span className="font-mono text-xs">{order.awb || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatINR(order.total)}</span></div>
            {order.invoiceNo && (
              <div className="flex justify-between"><span className="text-muted-foreground">Invoice</span><span className="font-mono text-xs">{order.invoiceNo}</span></div>
            )}
          </CardContent>
        </Card>
      </div>

      {channelManaged && (
        <Card>
          <CardHeader>
            <CardTitle>Myntra lines</CardTitle>
            <CardDescription>
              Read from Myntra PPMP{order.lastChannelSyncAt ? `, last synced ${formatDateTime(order.lastChannelSyncAt)}` : ''}.
              Status changes come from Myntra on the next sync.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Myntra status</TableHead>
                  <TableHead>Packet</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Ship by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order.channelLines || []).map((line) => (
                  <TableRow key={line.orderLineId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProductThumb name={line.sku} src={line.imageUrl} />
                        <span className="font-mono text-xs">{line.sku}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{line.orderLineId}</TableCell>
                    <TableCell><Badge variant="outline">{line.status || '—'}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{line.packetId || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{line.trackingNumber || '—'}</TableCell>
                    <TableCell>{line.shipByTime ? formatDateTime(line.shipByTime) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Order items</CardTitle>
          <CardDescription>Same product photo is kept on every split sub-order.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Fulfil from</TableHead>
                <TableHead>Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={`${item.sku}-${item.name}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ProductThumb name={item.name} src={item.imageUrl} size="lg" />
                      <span className="font-medium">{item.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell><Badge variant="outline">{item.fulfilmentSource || order.fulfilmentSource}</Badge></TableCell>
                  <TableCell>{formatINR(item.price)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Fulfilment & vendor tracking
          </CardTitle>
          <CardDescription>
            {`Each unit is a sub-order (${masterOrderBaseHint(order)}-1, -2, …) and can be assigned to a vendor on its own.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Sub-order</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Dispatch</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.subOrders.map((sub) => (
                <TableRow key={sub.id} className={highlightId === sub.id ? 'bg-emerald-50/80 dark:bg-emerald-950/20' : ''}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link className="text-primary hover:underline" to={`/orders/${encodeURIComponent(sub.id)}`}>{sub.id}</Link>
                    <div className="text-[11px] text-muted-foreground">index {sub.index}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ProductThumb name={sub.title} src={sub.imageUrl} />
                      <div>
                        <div>{sub.title}</div>
                        <div className="text-xs text-muted-foreground">{sub.sku} · qty {sub.qty}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-52">
                    {can(PERMISSIONS.ORDERS_EDIT) ? (
                      <Select
                        className="h-9"
                        value={sub.assignedVendor}
                        onChange={async (event) => {
                          const name = event.target.value;
                          const next = await assignSubOrder(order.id, sub.id, { assignedVendor: name });
                          if (next?.error) toast.error(next.error);
                          else toast.success(`${sub.id} assigned to ${name || 'unassigned'}`);
                        }}
                      >
                        <option value="">Unassigned</option>
                        {vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.name}>{vendor.name}</option>
                        ))}
                      </Select>
                    ) : (
                      sub.assignedVendor || '—'
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {sub.assignedVendor ? (
                      <>
                        <div>{sub.vendorPhone || '—'}</div>
                        <div className="text-muted-foreground">{sub.vendorEmail || sub.vendorLocation}</div>
                        {sub.vendorStatus && <div className="mt-1 font-medium">{sub.vendorStatus}</div>}
                        {sub.rejectReason && <div className="text-destructive">{sub.rejectReason}</div>}
                        {sub.trackingNumber && <div className="font-mono">{sub.courier} · {sub.trackingNumber}</div>}
                      </>
                    ) : '—'}
                  </TableCell>
                  <TableCell>{sub.assignedDate ? formatDate(sub.assignedDate) : '—'}</TableCell>
                  <TableCell>{sub.dispatchDate ? formatDate(sub.dispatchDate) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(sub.deliveryStatus || sub.status)}>{sub.deliveryStatus || sub.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {!channelManaged && (
                      <Button variant="ghost" size="sm" disabled={busy === sub.id} onClick={() => runLabel(sub.id)}>
                        Label
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Modal
        open={reverseOpen}
        onOpenChange={setReverseOpen}
        title="Book reverse pickup"
        description="A reverse label is generated and a new row is added on Returns to print it again."
        footer={
          <>
            <Button variant="outline" onClick={() => setReverseOpen(false)}>Cancel</Button>
            <Button
              disabled={busy === 'reverse'}
              onClick={async () => {
                setBusy('reverse');
                const next = await bookReversePickup(order.id, { reason: reverseReason, courier: reverseCourier, awb: reverseAwb });
                setBusy('');
                if (next?.error) {
                  toast.error(next.error);
                  return;
                }
                toast.success(`${next?.reversePickup?.returnId || 'Return'} is on the Returns tab`);
                setReverseOpen(false);
                navigate('/returns');
              }}
            >
              Generate reverse label
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Reason</label>
            <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Courier</label>
            <Select value={reverseCourier} onChange={(e) => setReverseCourier(e.target.value)}>
              <option>Delhivery</option>
              <option>Bluedart</option>
              <option>Xpressbees</option>
              <option>Ecom Express</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Reverse AWB</label>
            <Input value={reverseAwb} onChange={(e) => setReverseAwb(e.target.value)} placeholder="From the courier booking (optional)" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function masterHint(order) {
  const ids = (order.subOrders || []).map((sub) => sub.id);
  if (ids.length <= 1) return ids[0] || order.id;
  return `${ids[0]}, ${ids[1]}${ids.length > 2 ? '…' : ''}`;
}

function masterOrderBaseHint(order) {
  return String(order.id).replace(/-LEH$/i, '');
}
