import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate, formatDateTime, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import Modal from '../../components/ui/Modal';
import { ShoppingCart, Filter, RefreshCw, Download, Search, FileText, Eye, RotateCcw, CheckCircle, Check, X } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { isChannelManaged, packetIdOf, openMyntraDocument, pullMyntraOrders } from '../../lib/channelOrders';
import { downloadCsv } from '../../lib/orderMetrics';
import api, { apiError } from '../../lib/api';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';
import TableToolbar from '../../components/ui/TableToolbar';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import { withSubOrders } from '../../lib/orderSubOrders';
import { channelFromSearch } from '../../lib/ordersChannelLink';
import { searchFromParams } from '../../lib/headerSearch';
import { menuPosition, statusOptions, statusParam, selectedStatuses } from '../../lib/statusFilter';
import { toggleId, togglePage, packableIds, labelableIds } from '../../lib/bulkOrderActions';

const STATUS_TABS = [
  { id: 'Unfulfillable', label: 'Unfulfillable' },
  { id: 'New', label: 'New' },
  { id: 'Packed', label: 'Packed' },
  { id: 'Ready to Ship', label: 'Ready To Ship' },
  { id: 'Pickup & Manifest', label: 'Pickup & Manifest' },
  { id: 'In Transit', label: 'In Transit' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'RTO', label: 'RTO' },
  { id: 'Cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All Orders' },
];

const IN_TRANSIT = ['Dispatched', 'In transit'];

function ColumnFilter({ column, label, active, onOpen }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <button
        type="button"
        aria-label={`Filter by ${column}`}
        title={`Filter by ${column}`}
        onClick={onOpen}
        className={`rounded p-0.5 hover:bg-muted ${active ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Filter className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function StatusColumnFilter({ value, onChange }) {
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null);
  const [draft, setDraft] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!position) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);

  const options = statusOptions(STATUS_TABS, search);
  const allTicked = options.length > 0 && options.every((tab) => draft.includes(tab.id));
  const toggle = (id) => setDraft((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  const toggleAll = () => setDraft((prev) => (allTicked
    ? prev.filter((id) => !options.some((tab) => tab.id === id))
    : [...new Set([...prev, ...options.map((tab) => tab.id)])]));
  const apply = (next) => {
    onChange(next);
    setPosition(null);
  };

  return (
    <span ref={ref} className="inline-flex items-center gap-1">
      Status
      <button
        type="button"
        aria-label="Filter by status"
        title="Filter by status"
        onClick={(event) => {
          if (position) {
            setPosition(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setDraft(selectedStatuses(value, STATUS_TABS));
          setSearch('');
          setPosition(menuPosition(rect, window.innerWidth));
        }}
        className={`rounded p-0.5 hover:bg-muted ${value !== 'all' ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Filter className="h-3.5 w-3.5" />
      </button>
      {position && createPortal(
        <div
          ref={menuRef}
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 w-72 rounded-xl border bg-card p-2 text-left text-sm font-normal normal-case tracking-normal text-foreground shadow-pop"
        >
          <div className="px-1 pb-2 text-muted-foreground">Filter By Status</div>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Input autoFocus placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
            </div>
            <Button type="button" size="sm" variant="outline" className="h-8 px-2" aria-label="Clear status filter" title="Clear" onClick={() => apply('all')}>
              <X className="h-4 w-4" />
            </Button>
            <Button type="button" size="sm" className="h-8 px-2" aria-label="Apply status filter" title="Apply" onClick={() => apply(statusParam(draft, STATUS_TABS))}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-1 py-2 text-muted-foreground">No status matches</div>
            ) : (
              <>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-muted">
                  <input type="checkbox" checked={allTicked} onChange={toggleAll} />
                  SELECT ALL
                </label>
                {options.map((tab) => (
                  <label key={tab.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={draft.includes(tab.id)} onChange={() => toggle(tab.id)} />
                    {tab.label.toUpperCase()}
                  </label>
                ))}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [orderList, setOrderList] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, New: 0, Packed: 0, 'Ready to Ship': 0, Unfulfillable: 0 });
  const generateInvoice = useOrderStore((s) => s.generateInvoice);
  const markDelivered = useOrderStore((s) => s.markDelivered);
  const bookReversePickup = useOrderStore((s) => s.bookReversePickup);
  const setStatus = useOrderStore((s) => s.setStatus);
  const queueLabelJob = useOrderStore((s) => s.queueLabelJob);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState('');
  const [reverseFor, setReverseFor] = useState(null);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [activeTab, setActiveTab] = useState('all');
  const [searchParams] = useSearchParams();
  const [channelFilter, setChannelFilter] = useState(() => channelFromSearch(searchParams));
  const connected = useConnectedChannels();
  const connectedKey = connected.loaded ? (connected.labels.join(',') || '__none__') : '';
  const channelTabs = [
    { id: 'all', label: 'All channels' },
    ...connected.channels.map((channel) => {
      const label = orderChannelLabel(channel);
      return { id: label, label };
    }),
  ];
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [readyFilter, setReadyFilter] = useState('all');
  const [parcelFilter, setParcelFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState(() => searchFromParams(searchParams));
  const [syncing, setSyncing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [manifestData, setManifestData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(() => searchFromParams(searchParams));
  const urlQuery = searchFromParams(searchParams);

  useEffect(() => {
    if (urlQuery) setSearchQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadOrders = async (nextPage = page) => {
    setLoading(true);
    try {
      const { data } = await api.get('/orders', {
        params: {
          page: nextPage,
          limit: PAGE_SIZE,
          status: activeTab,
          channel: channelFilter,
          connected: connectedKey || undefined,
          payment: paymentFilter,
          source: sourceFilter,
          ready: readyFilter,
          parcel: parcelFilter,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          tzOffset: new Date().getTimezoneOffset(),
          q: query || undefined,
        },
      });
      setOrderList((data.data || []).map((order) => withSubOrders(order)));
      setSelectedIds([]);
      setTotal(data.meta?.total || 0);
      if (data.meta?.counts) setCounts(data.meta.counts);
      setLoadError('');
    } catch (err) {
      setLoadError(apiError(err, 'Could not load orders'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(page);
  }, [page, activeTab, channelFilter, paymentFilter, sourceFilter, readyFilter, parcelFilter, dateFrom, dateTo, query, connectedKey]);

  const filteredOrders = orderList;

  const kpiData = {
    total: counts.total || 0,
    newOrders: counts.New || 0,
    packed: counts.Packed || 0,
    readyToShip: counts['Ready to Ship'] || 0,
    unfulfillable: counts.Unfulfillable || 0,
  };

  const syncOrders = async () => {
    setSyncing(true);
    try {
      if (can(PERMISSIONS.SETTINGS_MANAGE)) {
        const job = await pullMyntraOrders();
        if (job.status === 'success') toast.success(job.shortSummary || 'Myntra orders synced');
        else if (job.status === 'running') toast(job.shortSummary);
        else toast.error(job.lastError || job.shortSummary || 'Myntra order pull failed');
      }
    } catch (err) {
      if (err?.response?.status !== 400) toast.error(apiError(err, 'Myntra order pull failed'));
    } finally {
      await loadOrders(page);
      setSyncing(false);
    }
  };

  const openChannelDoc = async (order, type) => {
    try {
      await openMyntraDocument(order, type);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openOrder = (order) => navigate(`/orders/${encodeURIComponent(order.id)}`);

  const pageIds = filteredOrders.map((order) => order.id);
  const allPageTicked = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const packSelected = async () => {
    const ids = packableIds(filteredOrders, selectedIds);
    if (!ids.length) {
      toast.error('Select New orders with mapped SKUs to pack');
      return;
    }
    setBulkBusy('pack');
    let failed = 0;
    for (const id of ids) {
      const next = await setStatus(id, 'Packed');
      if (next?.error) failed += 1;
    }
    setBulkBusy('');
    if (failed) toast.error(`${failed} of ${ids.length} orders could not be packed`);
    else toast.success(`${ids.length} order${ids.length === 1 ? '' : 's'} packed`);
    await loadOrders(page);
  };

  const labelSelected = async () => {
    const ids = labelableIds(filteredOrders, selectedIds);
    if (!ids.length) {
      toast.error('Select own-courier orders that still need a label. Amazon and Myntra use their own courier.');
      return;
    }
    setBulkBusy('label');
    const job = await queueLabelJob(ids);
    setBulkBusy('');
    if (job?.error) {
      toast.error(job.error);
      return;
    }
    toast.success(`One label job queued for ${ids.length} order${ids.length === 1 ? '' : 's'}`);
    await loadOrders(page);
  };

  const exportOrders = async () => {
    try {
      const { data } = await api.get('/orders', {
        params: {
          status: activeTab,
          channel: channelFilter,
          connected: connectedKey || undefined,
          payment: paymentFilter,
          source: sourceFilter,
          ready: readyFilter,
          parcel: parcelFilter,
          from: dateFrom || undefined,
          to: dateTo || undefined,
          tzOffset: new Date().getTimezoneOffset(),
          q: query || undefined,
        },
      });
      const rows = data.data || [];
      if (!rows.length) {
        toast.error('No orders in this view to export');
        return;
      }
      downloadCsv(`orders-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Order', 'Channel', 'Status', 'Payment', 'Fulfil from', 'Items', 'Value', 'Date'],
        rows.map((order) => [
          order.id,
          order.channel,
          order.status,
          order.paymentDetail ? `${order.paymentMode} (${order.paymentDetail})` : order.paymentMode,
          order.fulfilmentSource,
          (order.items || []).length,
          order.total,
          order.createdAt ? String(order.createdAt).slice(0, 10) : '',
        ]));
      toast.success(`Exported ${rows.length} orders`);
    } catch (err) {
      toast.error(apiError(err, 'Could not export orders'));
    }
  };

  const openManifests = async () => {
    try {
      const { data } = await api.get('/orders/manifests');
      setManifestData(data.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not load courier manifests'));
    }
  };

  const downloadManifest = (manifest) => {
    downloadCsv(`${manifest.manifestId}.csv`,
      ['Manifest ID', 'Courier', 'Date', 'Order', 'Channel order', 'AWB', 'Customer', 'City', 'Payment', 'COD amount', 'Qty'],
      manifest.rows.map((row) => [
        manifest.manifestId, manifest.courier, manifest.date, row.orderNo, row.channelOrderNo, row.awb,
        row.customer, row.city, row.paymentMode, row.codAmount, row.qty,
      ]));
  };

  if (loading) return <PageLoader label="Loading orders..." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Orders ({total})</h1>
          <p className="text-xs text-muted-foreground">Packing desk tabs: Unfulfillable, New, Packed, Ready To Ship. Shipping tabs: Pickup & Manifest, In Transit, Delivered, RTO.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(PERMISSIONS.ORDERS_EDIT) && (
            <Button variant="outline" size="sm" onClick={packSelected} disabled={!selectedIds.length || Boolean(bulkBusy)}>
              {bulkBusy === 'pack' ? 'Packing…' : `Pack selected (${selectedIds.length})`}
            </Button>
          )}
          {can(PERMISSIONS.SHIPPING_GENERATE) && (
            <Button variant="outline" size="sm" onClick={labelSelected} disabled={!selectedIds.length || Boolean(bulkBusy)}>
              {bulkBusy === 'label' ? 'Queuing…' : `Generate labels (${selectedIds.length})`}
            </Button>
          )}
          {activeTab === 'Ready to Ship' && can(PERMISSIONS.SHIPPING_GENERATE) && (
            <Button variant="outline" size="sm" onClick={openManifests}>
              <FileText className="w-4 h-4 mr-2" />
              Courier manifests
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={syncOrders} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Orders'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportOrders}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {loadError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total Orders" value={kpiData.total} icon={ShoppingCart} tone="blue" onClick={() => { setActiveTab('all'); setPage(1); }} />
        <KpiCard label="Unfulfillable" value={kpiData.unfulfillable} icon={Filter} tone="rose" onClick={() => { setActiveTab('Unfulfillable'); setPage(1); }} />
        <KpiCard label="New" value={kpiData.newOrders} icon={Filter} tone="emerald" onClick={() => { setActiveTab('New'); setPage(1); }} />
        <KpiCard label="Packed" value={kpiData.packed} icon={Filter} tone="sky" onClick={() => { setActiveTab('Packed'); setPage(1); }} />
        <KpiCard label="Ready To Ship" value={kpiData.readyToShip} icon={Filter} tone="amber" onClick={() => { setActiveTab('Ready to Ship'); setPage(1); }} />
      </div>

      <Card>
        <CardContent className="space-y-2 p-3">
          <TableToolbar
            search={(
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Order ID, sub-order, or customer"
                  className="h-9 w-full rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] pl-10 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary-blue))]/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
            filters={(
              <Button variant="outline" size="sm" className="h-9" onClick={() => setFiltersOpen(true)}>
                <Filter className="mr-2 h-4 w-4" />
                More filters
              </Button>
            )}
          />
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {channelTabs.map((tab) => (
              <Button
                key={tab.id}
                variant={channelFilter === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setChannelFilter(tab.id); setPage(1); }}
                className="h-7 whitespace-nowrap px-2.5 text-xs"
              >
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {STATUS_TABS.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setActiveTab(tab.id); setPage(1); }}
                className="h-7 whitespace-nowrap px-2.5 text-xs"
              >
                {tab.label}
                {typeof counts[tab.id] === 'number' && ` (${counts[tab.id]})`}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          {filteredOrders.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="h-7 w-7 text-muted-foreground" />}
              title="No orders found"
              description="Change the tab, search, or filters to see orders."
              action={<Button variant="outline" onClick={() => { setActiveTab('all'); setSearchQuery(''); setChannelFilter('all'); setDateFrom(''); setDateTo(''); setPage(1); }}>Reset</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all orders on this page"
                      checked={allPageTicked}
                      onChange={() => setSelectedIds((prev) => togglePage(prev, pageIds))}
                    />
                  </TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Fulfil From</TableHead>
                  <TableHead><StatusColumnFilter value={activeTab} onChange={(next) => { setActiveTab(next); setPage(1); }} /></TableHead>
                  <TableHead><ColumnFilter column="payment" label="Payment" active={paymentFilter !== 'all'} onOpen={() => setFiltersOpen(true)} /></TableHead>
                  <TableHead><ColumnFilter column="date" label="Date" active={Boolean(dateFrom || dateTo)} onOpen={() => setFiltersOpen(true)} /></TableHead>
                  <TableHead>SLA Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer" onClick={() => openOrder(order)}>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${order.channelOrderNo || order.id}`}
                        checked={selectedIds.includes(order.id)}
                        onChange={() => setSelectedIds((prev) => toggleId(prev, order.id))}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="text-primary hover:underline">{order.channelOrderNo || order.id}</span>
                      {order.channelOrderNo && order.channelOrderNo !== order.id && (
                        <div className="text-[11px] text-muted-foreground">{order.id}</div>
                      )}
                      {(order.subOrders || []).length > 1 && (
                        <div className="text-[11px] text-muted-foreground">{order.subOrders.length} sub-orders</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{order.customer}</div>
                      <div className="text-xs text-muted-foreground">{order.city}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.channel}</Badge>
                      {isChannelManaged(order) && (
                        <div className="text-[11px] text-emerald-600 mt-1" title={`Myntra status ${order.channelStatus || '—'}`}>
                          Live · {order.channelStatus || '—'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell><ItemThumbs items={order.items} /></TableCell>
                    <TableCell>{formatINR(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.mappingFailed ? 'Unmapped' : order.fulfilmentSource}</Badge>
                      {order.routeNote && (
                        <div className="text-xs text-muted-foreground mt-1">{order.routeNote}</div>
                      )}
                      {order.assignedVendor && (
                        <div className="text-xs text-muted-foreground mt-1">{order.assignedVendor}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
                      {order.orderReady && (
                        <div className="mt-1"><Badge variant="outline" className="border-emerald-500 text-emerald-700">Order ready</Badge></div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.paymentMode}</Badge>
                      {order.paymentDetail === 'Partially paid' && (
                        <div className="text-xs text-muted-foreground mt-1">Partially paid, handled as COD</div>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell>
                      {order.slaDate ? (
                        <span className="whitespace-nowrap font-medium text-red-600" title="Dispatch by this date">{formatDateTime(order.slaDate)}</span>
                      ) : '—'}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openOrder(order)}>
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                        {can(PERMISSIONS.FINANCE_VIEW) && !isChannelManaged(order) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const next = await generateInvoice(order.id);
                              if (next?.error) toast.error(next.error);
                              else toast.success(`Invoice ${next.invoiceNo} opened`);
                            }}
                          >
                            <FileText className="w-3 h-3 mr-1" />
                            Invoice
                          </Button>
                        )}
                        {isChannelManaged(order) && packetIdOf(order) && order.invoiceNo && (
                          <Button variant="ghost" size="sm" onClick={() => openChannelDoc(order, 'invoice')}>
                            <FileText className="w-3 h-3 mr-1" />
                            Invoice
                          </Button>
                        )}
                        {can(PERMISSIONS.ORDERS_EDIT) && IN_TRANSIT.includes(order.status) && !isChannelManaged(order) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const next = await markDelivered(order.id);
                              if (next?.error) { toast.error(next.error); return; }
                              toast.success(`${order.id} marked delivered. You can book reverse pickup now.`);
                            }}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Mark delivered
                          </Button>
                        )}
                        {(can(PERMISSIONS.SHIPPING_GENERATE) || can(PERMISSIONS.ORDERS_EDIT)) && order.status === 'Delivered' && !isChannelManaged(order) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReverseFor(order);
                              setReverseReason('Customer reverse pickup');
                              setReverseCourier(order.courier || 'Delhivery');
                            }}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            {order.reversePickup?.returnId ? 'Reverse booked' : 'Book reverse'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
        </CardContent>
      </Card>

      <Modal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="More filters"
        description="Narrow orders by status, payment, order date and fulfilment source."
        footer={
          <>
            <Button variant="outline" onClick={() => { setActiveTab('all'); setPaymentFilter('all'); setSourceFilter('all'); setReadyFilter('all'); setParcelFilter('all'); setDateFrom(''); setDateTo(''); setPage(1); }}>Clear</Button>
            <Button onClick={() => setFiltersOpen(false)}>Apply</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Status</label>
            <Select value={activeTab} onChange={(e) => { setActiveTab(e.target.value); setPage(1); }}>
              {activeTab.includes(',') && <option value={activeTab}>{selectedStatuses(activeTab, STATUS_TABS).length} statuses selected</option>}
              {STATUS_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Order date from</label>
              <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            </div>
            <div>
              <label className="text-sm font-medium">Order date to</label>
              <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Payment mode</label>
            <Select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="COD">COD</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Partially Paid">Partially Paid</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Fulfil from</label>
            <Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="Offline">Offline</option>
              <option value="Virtual">Virtual</option>
              <option value="Mixed">Mixed</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Order ready</label>
            <Select value={readyFilter} onChange={(e) => { setReadyFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="ready">Order ready{counts.Ready != null ? ` (${counts.Ready})` : ''}</option>
              <option value="not_ready">Not ready</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">Ready = every vendor (Virtual) item is marked Delivered or is in stock at the offline store.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Vendor parcel status</label>
            <Select value={parcelFilter} onChange={(e) => { setParcelFilter(e.target.value); setPage(1); }}>
              <option value="all">All</option>
              <option value="Dispatched">Dispatched by vendor (AWB)</option>
              <option value="Delivered">Delivered by vendor</option>
            </Select>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(manifestData)}
        onOpenChange={(open) => { if (!open) setManifestData(null); }}
        title="Courier manifests"
        description={manifestData ? `One manifest per courier for Ready to Ship orders on ${formatDate(manifestData.date)}.` : ''}
      >
        {manifestData && (
          <div className="space-y-2">
            {!manifestData.manifests.length && (
              <EmptyState title="No manifests today" description="Ready to Ship orders with an AWB show up here, grouped by courier." />
            )}
            {manifestData.manifests.map((manifest) => (
              <div key={manifest.manifestId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{manifest.courier}</p>
                  <p className="text-xs text-muted-foreground">
                    {manifest.manifestId} · {manifest.count} order{manifest.count === 1 ? '' : 's'}
                    {manifest.codTotal > 0 && ` · COD ${formatINR(manifest.codTotal)}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadManifest(manifest)}>
                  <Download className="w-4 h-4 mr-2" />
                  Download Manifest
                </Button>
              </div>
            ))}
            {manifestData.withoutAwb > 0 && (
              <p className="text-xs text-muted-foreground">
                {manifestData.withoutAwb} Ready to Ship order{manifestData.withoutAwb === 1 ? ' has' : 's have'} no AWB yet and {manifestData.withoutAwb === 1 ? 'is' : 'are'} not on a manifest.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(reverseFor)}
        onOpenChange={(open) => { if (!open) setReverseFor(null); }}
        title="Book reverse pickup"
        description={reverseFor ? `Creates a Returns row for ${reverseFor.id} and opens the reverse pickup label.` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setReverseFor(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                const next = await bookReversePickup(reverseFor.id, { reason: reverseReason, courier: reverseCourier });
                if (next?.error) {
                  toast.error(next.error);
                  return;
                }
                toast.success(`Reverse pickup ${next?.reversePickup?.returnId || ''} is in Returns. Generate the reverse label there if you need another copy.`);
                setReverseFor(null);
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
            <input
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
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
        </div>
      </Modal>
    </div>
  );
}
