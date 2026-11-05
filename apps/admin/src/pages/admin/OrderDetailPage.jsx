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
import { FileText, Printer, ArrowLeft, Store, RotateCcw, CheckCircle, Pencil } from 'lucide-react';
import { isChannelManaged, packetIdOf, openMyntraDocument, openAmazonLabel } from '../../lib/channelOrders';
import { amazonLabelStep, courierChoice, courierOptionText, labelRequest, pickupSlotText, rateNote } from '../../lib/shippingStatus';
import { shortOrderId, shortSubOrderId } from '../../lib/orderIds';
import { vendorPick, mappedVendor, pendingAssigns, vendorSaveAction } from '../../lib/vendorLines';
import { barcodeBars, printBarcodeLabel } from '../../lib/barcodeLabel';
import { PACKAGE_SOURCE, packageForm, packageSize, packageWeight } from '../../lib/itemPackage';
import { canEditOrder, asksShopifyPush, orderEditForm } from '../../lib/orderEdit';
import api from '../../lib/api';

const RISK_TONE = { High: 'text-red-600', Medium: 'text-orange-500', Low: 'text-green-600' };

function BarcodeImage({ value }) {
  const { bars, width } = barcodeBars(value);
  if (!width) return <span>{value || '—'}</span>;
  return (
    <span className="inline-flex flex-col items-center rounded bg-white px-1.5 pt-1 pb-0.5 text-black" title={value}>
      <svg viewBox={`0 0 ${width} 28`} className="h-7 w-28" preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`}>
        {bars.map((bar) => <rect key={bar.x} x={bar.x} y="0" width={bar.w} height="28" fill="currentColor" />)}
      </svg>
      <span className="text-[10px] leading-tight">{value}</span>
    </span>
  );
}

function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const orders = useOrderStore((s) => s.orders);
  const getById = useOrderStore((s) => s.getById);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const generateLabel = useOrderStore((s) => s.generateLabel);
  const amazonLabels = useOrderStore((s) => s.amazonLabels);
  const generateInvoice = useOrderStore((s) => s.generateInvoice);
  const assignSubOrder = useOrderStore((s) => s.assignSubOrder);
  const vendorUpdate = useOrderStore((s) => s.vendorUpdate);
  const markDelivered = useOrderStore((s) => s.markDelivered);
  const bookReversePickup = useOrderStore((s) => s.bookReversePickup);
  const editOrder = useOrderStore((s) => s.editOrder);
  const saveOrderNotes = useOrderStore((s) => s.saveOrderNotes);
  const [notesDraft, setNotesDraft] = useState(null);
  const saveItemPackage = useOrderStore((s) => s.saveItemPackage);
  const [packItem, setPackItem] = useState(null);
  const [packForm, setPackForm] = useState(packageForm());
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(orderEditForm());
  const [askPush, setAskPush] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelCouriers, setLabelCouriers] = useState([]);
  const [courierCode, setCourierCode] = useState('delhivery');
  const [labelAwb, setLabelAwb] = useState('');
  const [labelPackage, setLabelPackage] = useState(null);
  const [customerGstin, setCustomerGstin] = useState('');
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [reverseAwb, setReverseAwb] = useState('');
  const allVendors = useVendorStore((s) => s.vendors);
  const loadVendors = useVendorStore((s) => s.load);
  const vendors = useMemo(() => allVendors.filter((vendor) => !vendor.removed && vendor.status === 'Active'), [allVendors]);
  const [busy, setBusy] = useState('');
  const [picks, setPicks] = useState({});
  const [tracking, setTracking] = useState(null);
  const [history, setHistory] = useState(null);
  const mapItemSku = useOrderStore((s) => s.mapItemSku);
  const [mapItem, setMapItem] = useState(null);
  const [mapCode, setMapCode] = useState('');
  const [masterHits, setMasterHits] = useState([]);

  const loaded = useOrderStore((s) => s.loaded);
  const fetchOrder = useOrderStore((s) => s.fetchOrder);
  const [lookup, setLookup] = useState({ id: '', done: false });

  useEffect(() => {
    hydrateFromApi();
    loadVendors();
  }, [hydrateFromApi, loadVendors]);

  useEffect(() => {
    if (!mapItem) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/master-skus', { params: { q: mapCode.trim(), page: 1, limit: 20 } });
        if (live) setMasterHits(data.data || []);
      } catch {
        if (live) setMasterHits([]);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mapItem, mapCode]);

  const order = useMemo(() => getById(orderId), [getById, orderId, orders]);
  const highlightId = order && order.id !== orderId ? orderId : '';
  const masterId = order?.id;

  useEffect(() => {
    if (!masterId) return undefined;
    let live = true;
    setHistory(null);
    api.get(`/orders/${encodeURIComponent(masterId)}/customer-history`)
      .then(({ data }) => { if (live) setHistory(data.data); })
      .catch(() => { if (live) setHistory(null); });
    return () => { live = false; };
  }, [masterId]);

  useEffect(() => {
    if (!loaded || order || lookup.id === orderId) return;
    setLookup({ id: orderId, done: false });
    fetchOrder(orderId).finally(() => {
      setLookup((current) => (current.id === orderId ? { id: orderId, done: true } : current));
    });
  }, [loaded, order, orderId, lookup.id, fetchOrder]);

  const hasPackages = Boolean(order?.items?.every((item) => item.package));
  useEffect(() => {
    if (!masterId || hasPackages) return;
    fetchOrder(masterId);
  }, [masterId, hasPackages, fetchOrder]);

  const lookedUp = lookup.id === orderId && lookup.done;
  if (!order && (!loaded || !lookedUp)) return <div className="p-6 text-sm text-muted-foreground">Loading order…</div>;

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

  const openLabel = () => {
    setCourierCode('delhivery');
    setLabelAwb('');
    setLabelOpen(true);
    setLabelPackage(null);
    api.get(`/orders/${encodeURIComponent(order.id)}/courier-rates`)
      .then(({ data }) => { setLabelCouriers(data.data?.couriers || []); setLabelPackage(data.data?.package || null); })
      .catch(() => setLabelCouriers([]));
  };

  const { list: courierList, picked } = courierChoice(labelCouriers, courierCode);

  const saveLabel = async () => {
    const request = labelRequest(picked, labelAwb);
    if (request.error) { toast.error(request.error); return; }
    setBusy('label');
    const next = await generateLabel(order.id, undefined, request.body);
    setBusy('');
    if (next?.error) { toast.error(next.error); return; }
    setLabelOpen(false);
    toast.success(`${picked.name} label done. ${next.id} is ${next.status}.`);
  };

  const printAmazonLabel = async () => {
    try {
      await openAmazonLabel(order);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runAmazonLabel = async () => {
    setBusy('amazon-label');
    const result = await amazonLabels([order.id]);
    setBusy('');
    if (result?.error) { toast.error(result.error); return; }
    const made = result?.done?.[0];
    if (!made) { toast.error(result?.failed?.[0]?.reason || 'Easy Ship label was not made'); return; }
    toast.success(`Easy Ship label made. AWB ${made.awb}.`);
    await printAmazonLabel();
  };

  const openInvoice = () => {
    setCustomerGstin(order.customerGstin || '');
    setInvoiceOpen(true);
  };

  const runInvoice = async () => {
    setBusy('invoice');
    const next = await generateInvoice(order.id, { customerGstin });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    setInvoiceOpen(false);
    toast.success(`Invoice ${next.invoiceNo} opened`);
  };

  const openEdit = () => {
    setEditForm(orderEditForm(order));
    setAskPush(false);
    setEditOpen(true);
  };

  const saveEdit = async (pushToShopify) => {
    setBusy('edit');
    const next = await editOrder(order.id, { ...editForm, pushToShopify });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(next.message || 'Order updated');
    setEditOpen(false);
  };

  const setEditField = (key) => (e) => setEditForm((form) => ({ ...form, [key]: e.target.value }));

  const saveNotes = async () => {
    setBusy('notes');
    const next = await saveOrderNotes(order.id, notesDraft);
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(next.message || 'Order notes saved');
    setNotesDraft(null);
  };

  const openPack = (item, index) => {
    setPackItem({ ...item, index });
    setPackForm(packageForm(item.package));
  };

  const savePack = async () => {
    setBusy('pack');
    const next = await saveItemPackage(order.id, packItem.index, packForm);
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(next.message || 'Weight and size saved');
    setPackItem(null);
  };

  const openMap = (item) => {
    setMapItem(item);
    setMapCode('');
    setMasterHits([]);
  };

  const saveMap = async () => {
    setBusy('map');
    const next = await mapItemSku(order.id, { sku: mapItem.sku, masterSkuCode: mapCode });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(next.message || 'SKU mapped');
    setMapItem(null);
  };

  const channelManaged = isChannelManaged(order);
  const amazonOrder = order.channel === 'Amazon';
  const amazonStep = amazonLabelStep(order);
  const amazonSlot = pickupSlotText(order);
  const packetId = packetIdOf(order);
  const displayId = shortOrderId(order);

  const isSavedVendor = (name) => vendors.some((vendor) => vendor.name.toLowerCase() === String(name || '').toLowerCase());
  const shopifyVendorOf = (sub) => order.items.find((item) => item.sku === sub.sku)?.vendor || order.shopifyVendor || '';
  const mappedOf = (sub) => mappedVendor(vendors, shopifyVendorOf(sub));

  const assignPicked = async (sub) => {
    const { value: name } = vendorPick(picks, sub, mappedOf(sub));
    setBusy(`assign-${sub.id}`);
    const next = await assignSubOrder(order.id, sub.id, { assignedVendor: name });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    setPicks(({ [sub.id]: _done, ...rest }) => rest);
    toast.success(`${shortSubOrderId(order, sub)} assigned to ${name || 'unassigned'}`);
  };

  const assignAll = async () => {
    const pending = pendingAssigns(order.subOrders, picks, mappedOf);
    setBusy('assign-all');
    let done = 0;
    for (const { sub, name } of pending) {
      const next = await assignSubOrder(order.id, sub.id, { assignedVendor: name });
      if (next?.error) {
        toast.error(`${shortSubOrderId(order, sub)}: ${next.error}`);
        continue;
      }
      done += 1;
      setPicks(({ [sub.id]: _done, ...rest }) => rest);
    }
    setBusy('');
    if (done) toast.success(`${done} sub-order${done === 1 ? '' : 's'} assigned`);
  };

  const openTracking = (sub) => setTracking({
    subId: sub.id,
    status: sub.vendorStatus,
    trackingNumber: sub.trackingNumber || '',
    courier: sub.courier || '',
    deliveryDate: sub.deliveredDate || todayIso(),
  });
  const trackingStep = tracking
    ? vendorSaveAction({ status: tracking.status, trackingNumber: tracking.trackingNumber, courier: tracking.courier, deliveryDate: tracking.deliveryDate })
    : null;

  const saveTracking = async () => {
    if (trackingStep.error) {
      toast.error(trackingStep.error);
      return;
    }
    setBusy('tracking');
    const next = await vendorUpdate(order.id, tracking.subId, {
      action: trackingStep.action,
      trackingNumber: tracking.trackingNumber,
      courier: tracking.courier,
      ...(trackingStep.action === 'deliver' ? { deliveredDate: tracking.deliveryDate } : {}),
    });
    setBusy('');
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    await fetchOrder(order.id);
    setTracking(null);
    toast.success('Tracking saved');
  };

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
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <Breadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: displayId }]} />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{displayId}</h1>
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
          {displayId !== order.id && (
            <p className="text-xs text-muted-foreground">OMS ref {order.id}</p>
          )}
          {history && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {history.pastOrders ? (
                <>
                  <span>Last order status: <span className="font-semibold">{history.lastOrderStatus || '—'}</span></span>
                  <span>Past orders: <span className="font-semibold">{history.pastOrders}</span></span>
                  <span>Delivered orders: <span className="font-semibold">{history.delivered}</span></span>
                  <span>Cancelled orders: <span className="font-semibold">{history.cancelled}</span></span>
                </>
              ) : (
                <span className="text-muted-foreground">First order from this customer</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/orders')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            All orders
          </Button>
          {can(PERMISSIONS.ORDERS_EDIT) && canEditOrder(order) && (
            <Button variant="outline" onClick={openEdit}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit order
            </Button>
          )}
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
            <Button variant="outline" disabled={busy === 'invoice'} onClick={openInvoice}>
              <FileText className="w-4 h-4 mr-2" />
              {busy === 'invoice' ? 'Opening…' : 'Generate Invoice'}
            </Button>
          )}
          {can(PERMISSIONS.SHIPPING_GENERATE) && amazonStep === 'make' && (
            <Button disabled={busy === 'amazon-label'} onClick={runAmazonLabel}>
              <Printer className="w-4 h-4 mr-2" />
              {busy === 'amazon-label' ? 'Making label…' : 'Make Easy Ship label'}
            </Button>
          )}
          {can(PERMISSIONS.SHIPPING_GENERATE) && amazonStep === 'print' && (
            <Button onClick={printAmazonLabel}>
              <Printer className="w-4 h-4 mr-2" />
              Amazon label
            </Button>
          )}
          {(can(PERMISSIONS.SHIPPING_GENERATE) || can(PERMISSIONS.ORDERS_EDIT)) && !channelManaged && !amazonOrder && (
            <Button disabled={busy === 'label'} onClick={openLabel}>
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
                toast.success(`${displayId} marked delivered. Book reverse pickup when you are ready.`);
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

      {amazonOrder && (
        <div role="note" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Amazon orders use Amazon Easy Ship labels, not Delhivery.</span>{' '}
          {amazonStep === 'make' && 'Make Easy Ship label books the Amazon pickup, saves the AWB and opens the label PDF. '}
          {amazonStep === 'print' && `Label made${order.awb ? ` · AWB ${order.awb}` : ''}${amazonSlot ? ` · ${amazonSlot}` : ''}. Print it with Amazon label. `}
          <span className="text-muted-foreground">
            Bulk labels, Mark dispatched and Cancel label are on the{' '}
            <Link to="/shipping" className="underline">Shipping page</Link>.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Customer & address</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">
                Customer
                {history?.risk && (
                  <span className={`ml-2 text-xs font-semibold uppercase ${RISK_TONE[history.risk]}`}>{history.risk} risk</span>
                )}
              </p>
              <p className="font-medium">{order.customer}</p>
              <p className="text-xs text-muted-foreground">{order.phone}</p>
              <p className="text-xs text-muted-foreground">{order.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Placed</p>
              <p className="font-medium">{formatDateTime(order.createdAt)}</p>
              <p className="text-xs text-muted-foreground mt-2">Fulfil from {order.fulfilmentSource}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Shipping address</p>
              <p>{order.address || order.city}</p>
              {order.address && order.city && <p className="text-xs text-muted-foreground">{order.city}</p>}
            </div>
            <div>
              <p className="text-muted-foreground">Order notes</p>
              {can(PERMISSIONS.ORDERS_EDIT) ? (
                <>
                  <textarea
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    rows={2}
                    maxLength={1000}
                    placeholder="e.g. Dispatch after 10 Nov. Customer not available."
                    value={notesDraft ?? order.notes ?? ''}
                    onChange={(e) => setNotesDraft(e.target.value)}
                  />
                  {notesDraft !== null && notesDraft !== (order.notes || '') && (
                    <div className="mt-1 flex gap-2">
                      <Button size="sm" disabled={busy === 'notes'} onClick={saveNotes}>
                        {busy === 'notes' ? 'Saving…' : 'Save notes'}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === 'notes'} onClick={() => setNotesDraft(null)}>Cancel</Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="whitespace-pre-wrap">{order.notes || '—'}</p>
              )}
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
                        <ProductThumb name={line.sku} sku={line.sku} src={line.imageUrl} />
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
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Fulfil from</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Size (L × B × H)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item, index) => (
                <TableRow key={`${item.sku}-${item.name}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ProductThumb name={item.name} sku={item.sku} src={item.imageUrl} size="lg" />
                      <div className="min-w-[14rem] space-y-1">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Shopify vendor: <span className="font-medium text-foreground">{item.vendor || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-1">
                      <BarcodeImage value={item.barcode || item.sku} />
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Print barcode (51 x 25 mm PDF)"
                        aria-label={`Print barcode for ${item.sku}`}
                        onClick={() => {
                          try {
                            printBarcodeLabel({ value: item.barcode || item.sku, name: item.name });
                          } catch (err) {
                            toast.error(err.message);
                          }
                        }}
                      >
                        <Printer className="w-3 h-3" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>{item.qty}</TableCell>
                  <TableCell>
                    {item.mappingFailed ? (
                      <div className="space-y-1">
                        <Badge variant="destructive">Unmapped</Badge>
                        <div className="text-[11px] text-muted-foreground">Map it before pack or vendor assign.</div>
                        {can(PERMISSIONS.CATALOG_EDIT) && (
                          <Button size="sm" variant="outline" onClick={() => openMap(item)}>
                            Map SKU
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline">{item.fulfilmentSource || order.fulfilmentSource}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatINR(item.price)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div>{packageWeight(item.package)}</div>
                    {item.package && (
                      <div className="text-[11px] text-muted-foreground">{PACKAGE_SOURCE[item.package.source]}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <span>{packageSize(item.package)}</span>
                      {can(PERMISSIONS.ORDERS_EDIT) && !order.awb && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Edit weight and size"
                          aria-label={`Edit weight and size for ${item.sku}`}
                          onClick={() => openPack(item, index)}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </TableCell>
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
            {order.orderReady && <Badge variant="outline" className="border-emerald-500 text-emerald-700">Order ready</Badge>}
          </CardTitle>
          <CardDescription>
            {`Each unit is a sub-order (${displayId}-1, -2, …) and can be assigned to a vendor on its own.`}
          </CardDescription>
          {can(PERMISSIONS.ORDERS_EDIT) && (
            <div>
              <Button
                size="sm"
                disabled={!pendingAssigns(order.subOrders, picks, mappedOf).length || busy === 'assign-all'}
                onClick={assignAll}
              >
                Assign all
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sub-order</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Shopify vendor</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Dispatch</TableHead>
                <TableHead>Date of delivery</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.subOrders.map((sub) => (
                <TableRow key={sub.id} className={highlightId === sub.id ? 'bg-emerald-50/80 dark:bg-emerald-950/20' : ''}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link className="text-primary hover:underline" to={`/orders/${encodeURIComponent(sub.id)}`}>{shortSubOrderId(order, sub)}</Link>
                    <div className="text-[11px] text-muted-foreground">index {sub.index}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ProductThumb name={sub.title} sku={sub.sku} src={sub.imageUrl} />
                      <div>
                        <div>{sub.title}</div>
                        <div className="text-xs text-muted-foreground">{sub.sku} · qty {sub.qty}</div>
                        <div className="text-xs text-muted-foreground">Offline stock: {sub.offlineQty ?? 0}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">{shopifyVendorOf(sub) || '—'}</div>
                    {can(PERMISSIONS.ORDERS_EDIT) && shopifyVendorOf(sub) && !mappedOf(sub) && (
                      <div className="text-[11px] text-muted-foreground">Not in Vendors yet</div>
                    )}
                    {can(PERMISSIONS.ORDERS_EDIT) && mappedOf(sub) && !isSavedVendor(shopifyVendorOf(sub)) && (
                      <div className="text-[11px] text-muted-foreground">Mapped to {mappedOf(sub)}</div>
                    )}
                  </TableCell>
                  <TableCell className="w-52">
                    {can(PERMISSIONS.ORDERS_EDIT) ? (
                      <>
                        <Select
                          className="h-9"
                          value={vendorPick(picks, sub, mappedOf(sub)).value}
                          onChange={(event) => setPicks((prev) => ({ ...prev, [sub.id]: event.target.value }))}
                        >
                          <option value="">Unassigned</option>
                          {sub.assignedVendor && !isSavedVendor(sub.assignedVendor) && (
                            <option value={sub.assignedVendor}>{sub.assignedVendor}</option>
                          )}
                          {vendors.map((vendor) => (
                            <option key={vendor.id} value={vendor.name}>{vendor.name}</option>
                          ))}
                        </Select>
                        {!vendors.length && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            No vendors yet. <Link className="text-primary hover:underline" to="/vendors">Add vendors</Link>
                          </div>
                        )}
                      </>
                    ) : (
                      sub.assignedVendor || '—'
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {sub.assignedVendor ? (
                      <>
                        <div>{sub.vendorPhone || '—'}</div>
                        <div className="text-muted-foreground">{sub.vendorEmail || sub.vendorLocation}</div>
                        {sub.assignNotice && (
                          <div className={sub.assignNotice === 'sent' ? 'mt-1 text-emerald-700' : 'mt-1 text-destructive'}>
                            {sub.assignNotice === 'sent' ? 'Assigned' : 'Message failed'}
                          </div>
                        )}
                        {sub.vendorStatus && <div className="mt-1 font-medium">{sub.vendorStatus}</div>}
                        {sub.rejectReason && <div className="text-destructive">{sub.rejectReason}</div>}
                        {sub.trackingNumber && <div className="font-mono">{sub.courier} · {sub.trackingNumber}</div>}
                      </>
                    ) : '—'}
                  </TableCell>
                  <TableCell>{sub.assignedDate ? formatDate(sub.assignedDate) : '—'}</TableCell>
                  <TableCell>{sub.dispatchDate ? formatDate(sub.dispatchDate) : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {can(PERMISSIONS.ORDERS_EDIT) && sub.assignedVendor ? (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => openTracking(sub)}
                        aria-label={`Edit date of delivery for ${shortSubOrderId(order, sub)}`}
                      >
                        {sub.deliveredDate ? formatDate(sub.deliveredDate) : '—'}
                      </button>
                    ) : (sub.deliveredDate ? formatDate(sub.deliveredDate) : '—')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(sub.deliveryStatus || sub.status)}>{sub.deliveryStatus || sub.status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {!channelManaged && !amazonOrder && (
                      <Button variant="ghost" size="sm" disabled={busy === sub.id} onClick={() => runLabel(sub.id)}>
                        Label
                      </Button>
                    )}
                    {can(PERMISSIONS.ORDERS_EDIT) && (
                      <Button
                        size="sm"
                        className="ml-1"
                        disabled={!vendorPick(picks, sub, mappedOf(sub)).changed || busy === `assign-${sub.id}`}
                        onClick={() => assignPicked(sub)}
                      >
                        Assign
                      </Button>
                    )}
                    {can(PERMISSIONS.ORDERS_EDIT) && sub.assignedVendor && (
                      <Button variant="outline" size="sm" className="ml-1" onClick={() => openTracking(sub)}>
                        Tracking
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
        open={Boolean(tracking)}
        onOpenChange={(open) => { if (!open) setTracking(null); }}
        title="Tracking & delivery"
        description="Tracking ID comes from the vendor portal; enter it here if the vendor shared it another way. Delivery date marks a dispatched line Delivered."
        footer={(
          <>
            <Button variant="outline" onClick={() => setTracking(null)}>Cancel</Button>
            <Button disabled={busy === 'tracking'} onClick={saveTracking}>
              {{ dispatch: 'Mark dispatched', deliver: 'Mark delivered' }[trackingStep?.action] || 'Save'}
            </Button>
          </>
        )}
      >
        {tracking && (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Tracking ID (AWB)</label>
              <Input value={tracking.trackingNumber} onChange={(e) => setTracking((prev) => ({ ...prev, trackingNumber: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">Courier</label>
              <Input value={tracking.courier} onChange={(e) => setTracking((prev) => ({ ...prev, courier: e.target.value }))} />
            </div>
            {tracking.status === 'Dispatched' && (
              <div>
                <label className="text-sm font-medium">Date of delivery</label>
                <Input type="date" value={tracking.deliveryDate} onChange={(e) => setTracking((prev) => ({ ...prev, deliveryDate: e.target.value }))} />
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={askPush ? 'Push this change to Shopify?' : 'Edit order'}
        description={askPush
          ? 'Yes updates the order on Shopify too. No keeps the change here in OMS only.'
          : 'Customer and shipping details can be changed until a label is generated.'}
        footer={askPush ? (
          <>
            <Button variant="outline" disabled={busy === 'edit'} onClick={() => saveEdit(false)}>No, keep it here only</Button>
            <Button disabled={busy === 'edit'} onClick={() => saveEdit(true)}>Yes, push to Shopify</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              disabled={busy === 'edit'}
              onClick={() => (asksShopifyPush(order) ? setAskPush(true) : saveEdit(false))}
            >
              Save
            </Button>
          </>
        )}
      >
        {!askPush && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Customer</label>
              <Input value={editForm.customer} onChange={setEditField('customer')} />
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input value={editForm.phone} onChange={setEditField('phone')} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Email</label>
              <Input value={editForm.email} onChange={setEditField('email')} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium">Shipping address</label>
              <Input value={editForm.address} onChange={setEditField('address')} />
            </div>
            <div>
              <label className="text-sm font-medium">City and PIN</label>
              <Input value={editForm.city} onChange={setEditField('city')} placeholder="Hyderabad 500008" />
            </div>
            <div>
              <label className="text-sm font-medium">State</label>
              <Input value={editForm.shipState} onChange={setEditField('shipState')} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={labelOpen}
        onOpenChange={setLabelOpen}
        title="Generate label"
        description="Choose the courier for this order. Only couriers enabled for this company are shown."
        footer={
          <>
            <Button variant="outline" onClick={() => setLabelOpen(false)}>Cancel</Button>
            <Button disabled={busy === 'label'} onClick={saveLabel}>
              {busy === 'label' ? 'Booking…' : `Book ${picked.name}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Courier
            <Select className="mt-1" value={picked.code} onChange={(event) => { setCourierCode(event.target.value); setLabelAwb(''); }}>
              {courierList.map((courier) => (
                <option key={courier.code} value={courier.code}>{courierOptionText(courier)}</option>
              ))}
            </Select>
          </label>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{rateNote(picked, labelPackage)}</p>
          {!picked.api && (
            <label className="block text-sm font-medium">
              {picked.name} AWB
              <Input className="mt-1" value={labelAwb} onChange={(event) => setLabelAwb(event.target.value)} placeholder={`AWB from the ${picked.name} portal`} />
            </label>
          )}
          <p className="text-sm text-muted-foreground">
            {picked.api
              ? 'Delhivery is booked by API from WH-001 and the label opens. The tracking number is sent to Shopify.'
              : `Book the shipment on the ${picked.name} portal, then enter its AWB here. The tracking number is sent to Shopify. Couriers are enabled in Settings › Couriers.`}
          </p>
        </div>
      </Modal>

      <Modal
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        title="Generate invoice"
        description="Billed To and Ship To come from the order's customer details. For a B2B sale, add the buyer's GSTIN; it is saved on this order only and is not sent to Shopify."
        footer={
          <>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button disabled={busy === 'invoice'} onClick={runInvoice}>
              {busy === 'invoice' ? 'Opening…' : 'Generate Invoice'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="invoice-customer-gstin">Customer GSTIN (B2B, optional)</label>
          <Input
            id="invoice-customer-gstin"
            value={customerGstin}
            onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
            placeholder="07AAQCP4784P1ZB"
            maxLength={15}
          />
          <div className="text-xs text-muted-foreground">Leave empty for a normal customer (B2C) invoice.</div>
        </div>
      </Modal>

      <Modal
        open={Boolean(mapItem)}
        onOpenChange={(open) => { if (!open) setMapItem(null); }}
        title={`Map ${mapItem?.sku || 'SKU'}`}
        description="Link this channel SKU to a Master SKU. Every open order with this SKU is updated, so it can be packed or sent to a vendor."
        footer={
          <>
            <Button variant="outline" onClick={() => setMapItem(null)}>Cancel</Button>
            <Button disabled={busy === 'map' || !mapCode.trim()} onClick={saveMap}>
              Map SKU
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="map-master-sku">Master SKU</label>
          <Input
            id="map-master-sku"
            list="map-master-sku-list"
            value={mapCode}
            onChange={(e) => setMapCode(e.target.value)}
            placeholder="Search by Master SKU code or name"
            autoFocus
          />
          <datalist id="map-master-sku-list">
            {masterHits.map((sku) => (
              <option key={sku.id} value={sku.code}>{sku.name}</option>
            ))}
          </datalist>
          {mapItem?.name && <div className="text-xs text-muted-foreground">Order line: {mapItem.name}</div>}
        </div>
      </Modal>

      <Modal
        open={Boolean(packItem)}
        onOpenChange={(open) => { if (!open) setPackItem(null); }}
        title={`Weight and size · ${packItem?.sku || 'item'}`}
        description="Courier charges are decided on this. It starts from the product or company default; leave all empty to go back to that default."
        footer={
          <>
            <Button variant="outline" onClick={() => setPackItem(null)}>Cancel</Button>
            <Button disabled={busy === 'pack'} onClick={savePack}>
              {busy === 'pack' ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {[
            ['weightKg', 'Weight (kg)'],
            ['lengthCm', 'Length (cm)'],
            ['breadthCm', 'Breadth (cm)'],
            ['heightCm', 'Height (cm)'],
          ].map(([key, label]) => (
            <div key={key} className="space-y-1">
              <label className="text-sm font-medium" htmlFor={`pack-${key}`}>{label}</label>
              <Input
                id={`pack-${key}`}
                type="number"
                min="0"
                max="1000"
                step="any"
                value={packForm[key]}
                onChange={(e) => setPackForm((form) => ({ ...form, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </Modal>

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
  const ids = (order.subOrders || []).map((sub) => shortSubOrderId(order, sub));
  if (ids.length <= 1) return ids[0] || shortOrderId(order);
  return `${ids[0]}, ${ids[1]}${ids.length > 2 ? '…' : ''}`;
}
