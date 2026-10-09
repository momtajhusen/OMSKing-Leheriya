import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import Modal from '../../components/ui/Modal';
import { ShoppingCart, Filter, RefreshCw, Download, Search, FileText, Eye, RotateCcw, CheckCircle } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { isChannelManaged, packetIdOf, openMyntraDocument, pullMyntraOrders } from '../../lib/channelOrders';
import { downloadCsv } from '../../lib/orderMetrics';
import api, { apiError } from '../../lib/api';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';
import { CHANNEL_CATALOG, orderChannelLabel } from '../../constants/channelCatalog';
import { withSubOrders } from '../../lib/orderSubOrders';

const STATUS_TABS = [
  { id: 'Unfulfillable', label: 'Unfulfillable' },
  { id: 'New', label: 'New' },
  { id: 'Packed', label: 'Packed' },
  { id: 'Ready to Ship', label: 'Ready To Ship' },
  { id: 'Cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All Orders' },
];

const CHANNEL_TABS = [
  { id: 'all', label: 'All channels' },
  ...CHANNEL_CATALOG.map((channel) => ({ id: orderChannelLabel(channel), label: orderChannelLabel(channel) })),
];

const IN_TRANSIT = ['Dispatched', 'In transit'];

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
  const [reverseFor, setReverseFor] = useState(null);
  const [reverseReason, setReverseReason] = useState('Customer reverse pickup');
  const [reverseCourier, setReverseCourier] = useState('Delhivery');
  const [activeTab, setActiveTab] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');

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
          payment: paymentFilter,
          source: sourceFilter,
          q: query || undefined,
        },
      });
      setOrderList((data.data || []).map((order) => withSubOrders(order)));
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
  }, [page, activeTab, channelFilter, paymentFilter, sourceFilter, query]);

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

  const exportOrders = async () => {
    try {
      const { data } = await api.get('/orders', {
        params: {
          status: activeTab,
          channel: channelFilter,
          payment: paymentFilter,
          source: sourceFilter,
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

  if (loading) return <PageLoader label="Loading orders..." />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Orders</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Tabs used on the packing desk: Unfulfillable, New, Packed, Ready To Ship, Cancelled, All Orders. Delivered and in-transit orders stay under All Orders.</p>
        </div>
        <div className="flex gap-2">
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

      <div className="kpi-grid">
        <KpiCard label="Total Orders" value={kpiData.total} icon={ShoppingCart} tone="blue" onClick={() => { setActiveTab('all'); setPage(1); }} />
        <KpiCard label="Unfulfillable" value={kpiData.unfulfillable} icon={Filter} tone="rose" onClick={() => { setActiveTab('Unfulfillable'); setPage(1); }} />
        <KpiCard label="New" value={kpiData.newOrders} icon={Filter} tone="emerald" onClick={() => { setActiveTab('New'); setPage(1); }} />
        <KpiCard label="Packed" value={kpiData.packed} icon={Filter} tone="sky" onClick={() => { setActiveTab('Packed'); setPage(1); }} />
        <KpiCard label="Ready To Ship" value={kpiData.readyToShip} icon={Filter} tone="amber" onClick={() => { setActiveTab('Ready to Ship'); setPage(1); }} />
      </div>

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-1">
        {CHANNEL_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={channelFilter === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setChannelFilter(tab.id); setPage(1); }}
            className="text-xs whitespace-nowrap"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setActiveTab(tab.id); setPage(1); }}
            className="text-xs whitespace-nowrap"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by order ID, sub-order, or customer..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary-blue))]/20"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select className="w-full sm:w-44" value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}>
              <option value="all">All Channels</option>
              {CHANNEL_CATALOG.map((channel) => <option key={channel.id} value={orderChannelLabel(channel)}>{orderChannelLabel(channel)}</option>)}
            </Select>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setFiltersOpen(true)}>
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="h-7 w-7 text-muted-foreground" />}
              title="No orders found"
              description="Change the tab, search, or filters to see orders."
              action={<Button variant="outline" onClick={() => { setActiveTab('all'); setSearchQuery(''); setChannelFilter('all'); setPage(1); }}>Reset</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Fulfil From</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer" onClick={() => openOrder(order)}>
                    <TableCell className="font-medium">
                      <span className="text-primary hover:underline">{order.id}</span>
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
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.paymentMode}</Badge>
                      {order.paymentDetail === 'Partially paid' && (
                        <div className="text-xs text-muted-foreground mt-1">Partially paid, handled as COD</div>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
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
        description="Narrow orders by payment and fulfilment source."
        footer={
          <>
            <Button variant="outline" onClick={() => { setPaymentFilter('all'); setSourceFilter('all'); }}>Clear</Button>
            <Button onClick={() => setFiltersOpen(false)}>Apply</Button>
          </>
        }
      >
        <div className="space-y-3">
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
        </div>
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
