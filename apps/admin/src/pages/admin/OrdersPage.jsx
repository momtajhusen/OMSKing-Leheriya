import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { orders as orderSeed } from '../../mocks';
import { formatINR, formatDate, formatDateTime, statusBadgeVariant } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Drawer from '../../components/ui/Drawer';
import Modal from '../../components/ui/Modal';
import { ShoppingCart, Filter, RefreshCw, Download, Search, FileText, Eye, Package } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';

const STATUS_TABS = [
  { id: 'all', label: 'All Orders' },
  { id: 'New', label: 'New' },
  { id: 'Processing', label: 'Processing' },
  { id: 'Pending', label: 'Pending' },
  { id: 'Packed', label: 'Packed' },
  { id: 'Ready to Ship', label: 'Ready to Ship' },
  { id: 'Dispatched', label: 'Dispatched' },
  { id: 'Delivered', label: 'Delivered' },
  { id: 'Cancelled', label: 'Cancelled' },
  { id: 'exceptions', label: 'Exceptions' },
];

const CHANNEL_TABS = [
  { id: 'all', label: 'All channels' },
  { id: 'Shopify', label: 'Shopify' },
  { id: 'Amazon', label: 'Amazon' },
  { id: 'Myntra', label: 'Myntra' },
];

const EXCEPTION_STATUSES = ['Return Requested', 'RTO In Transit', 'NDR', 'Unfulfillable'];
const NEXT_STATUS = {
  New: 'Processing',
  Processing: 'Packed',
  Packed: 'Ready to Ship',
  Pending: 'Processing',
  'Ready to Ship': 'Dispatched',
};

export default function OrdersPage() {
  const { can } = usePermissions();
  const [activeTab, setActiveTab] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [orderList, setOrderList] = useState(orderSeed);
  const [selected, setSelected] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loading = useSimulatedLoad(activeTab);

  const filteredOrders = useMemo(() => orderList.filter((order) => {
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'exceptions'
        ? EXCEPTION_STATUSES.includes(order.status)
        : order.status === activeTab);
    const matchesChannel = channelFilter === 'all' || order.channel === channelFilter;
    const matchesPayment = paymentFilter === 'all' || order.paymentMode === paymentFilter;
    const matchesSource = sourceFilter === 'all' || order.fulfilmentSource === sourceFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q);
    return matchesTab && matchesChannel && matchesPayment && matchesSource && matchesSearch;
  }), [orderList, activeTab, channelFilter, paymentFilter, sourceFilter, searchQuery]);

  const kpiData = {
    total: orderList.length,
    newOrders: orderList.filter((o) => o.status === 'New').length,
    processing: orderList.filter((o) => o.status === 'Processing').length,
    readyToShip: orderList.filter((o) => o.status === 'Ready to Ship').length,
    dispatched: orderList.filter((o) => o.status === 'Dispatched').length,
  };

  const syncOrders = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success('Orders synced from Shopify, Amazon and Myntra');
    }, 700);
  };

  const generateInvoice = (order) => {
    const invoiceNo = order.channel === 'Shopify' ? order.id : `INV-${order.id}`;
    toast.success(`Invoice ${invoiceNo} generated`);
  };

  const advanceOrder = (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) {
      toast.error('No next action for this status');
      return;
    }
    setOrderList((prev) => prev.map((item) => (item.id === order.id ? { ...item, status: next } : item)));
    setSelected((current) => (current?.id === order.id ? { ...current, status: next } : current));
    toast.success(`${order.id} moved to ${next}`);
  };

  const exportOrders = () => {
    toast.success(`Exported ${filteredOrders.length} orders as CSV`);
  };

  if (loading) return <PageLoader label="Loading orders..." />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Orders</h1>
          <p className="text-sm sm:text-base text-muted-foreground">One marketplace order = one Master Order. Different warehouses become fulfilment groups, not a second order.</p>
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

      <div className="kpi-grid">
        <KpiCard label="Total Orders" value={kpiData.total} icon={ShoppingCart} tone="blue" onClick={() => setActiveTab('all')} />
        <KpiCard label="New" value={kpiData.newOrders} icon={Filter} tone="emerald" onClick={() => setActiveTab('New')} />
        <KpiCard label="Processing" value={kpiData.processing} icon={Filter} tone="sky" onClick={() => setActiveTab('Processing')} />
        <KpiCard label="Ready to Ship" value={kpiData.readyToShip} icon={Filter} tone="amber" onClick={() => setActiveTab('Ready to Ship')} />
        <KpiCard label="Dispatched" value={kpiData.dispatched} icon={Filter} tone="violet" onClick={() => setActiveTab('Dispatched')} />
      </div>

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-1">
        {CHANNEL_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={channelFilter === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setChannelFilter(tab.id)}
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
            onClick={() => setActiveTab(tab.id)}
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
                placeholder="Search by order ID or customer name..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary-blue))]/20"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select className="w-full sm:w-44" value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
              <option value="all">All Channels</option>
              <option value="Shopify">Shopify</option>
              <option value="Amazon">Amazon</option>
              <option value="Myntra">Myntra</option>
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
          <CardTitle>Orders ({filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredOrders.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="h-7 w-7 text-muted-foreground" />}
              title="No orders found"
              description="Change the tab, search, or filters to see orders."
              action={<Button variant="outline" onClick={() => { setActiveTab('all'); setSearchQuery(''); setChannelFilter('all'); }}>Reset</Button>}
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
                  <TableRow key={order.id} className="cursor-pointer" onClick={() => setSelected(order)}>
                    <TableCell className="font-medium">{order.id}</TableCell>
                    <TableCell>
                      <div>{order.customer}</div>
                      <div className="text-xs text-muted-foreground">{order.city}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                    <TableCell>{order.items.length}</TableCell>
                    <TableCell>{formatINR(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.fulfilmentSource}</Badge>
                      {order.assignedVendor && (
                        <div className="text-xs text-muted-foreground mt-1">{order.assignedVendor}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.paymentMode}</Badge>
                      {order.paymentMode === 'Partially Paid' && (
                        <div className="text-xs text-muted-foreground mt-1">handled as COD</div>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(order.createdAt)}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(order)}>
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                        {can(PERMISSIONS.FINANCE_VIEW) && (
                          <Button variant="ghost" size="sm" onClick={() => generateInvoice(order)}>
                            <FileText className="w-3 h-3 mr-1" />
                            Invoice
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Drawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected ? `Order ${selected.id}` : 'Order'} size="lg">
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant={statusBadgeVariant(selected.status)}>{selected.status}</Badge>
              <Badge variant="outline">{selected.channel}</Badge>
              <Badge variant="secondary">{selected.paymentMode}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Customer</p>
                <p className="font-medium">{selected.customer}</p>
                <p className="text-xs text-muted-foreground">{selected.phone}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">{formatDateTime(selected.createdAt)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">Address</p>
                <p>{selected.address || selected.city}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Items</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.items.map((item) => (
                    <TableRow key={item.sku}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.sku}</TableCell>
                      <TableCell>{item.qty}</TableCell>
                      <TableCell>{formatINR(item.price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Reservation & fulfilment groups</p>
              <p className="text-xs text-muted-foreground mb-2">One Master Order. Groups can split warehouse vs vendor; qty&gt;1 can split vendors.</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Reserve</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.items.map((item, index) => (
                    <TableRow key={`${item.sku}-fg`}>
                      <TableCell>FG-{index + 1}</TableCell>
                      <TableCell>{item.sku}</TableCell>
                      <TableCell>{item.qty}</TableCell>
                      <TableCell>{selected.fulfilmentSource === 'Virtual' ? (selected.assignedVendor || 'Vendor pending') : 'WH-001'}</TableCell>
                      <TableCell><Badge variant="outline">locked</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between text-sm font-semibold border-t pt-3">
              <span>Total</span>
              <span>{formatINR(selected.total)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {NEXT_STATUS[selected.status] && can(PERMISSIONS.ORDERS_EDIT) && (
                <Button onClick={() => advanceOrder(selected)}>
                  <Package className="w-4 h-4 mr-2" />
                  Move to {NEXT_STATUS[selected.status]}
                </Button>
              )}
              {selected.status === 'Cancelled' && can(PERMISSIONS.ORDERS_EDIT) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setOrderList((prev) => prev.map((item) => (item.id === selected.id ? { ...item, status: 'New' } : item)));
                    setSelected({ ...selected, status: 'New' });
                    toast.success(`${selected.id} unfulfilled again → New Orders`);
                  }}
                >
                  Mark Unfulfilled → New
                </Button>
              )}
              {can(PERMISSIONS.FINANCE_VIEW) && (
                <Button variant="outline" onClick={() => generateInvoice(selected)}>Generate invoice</Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

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
            <Select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="COD">COD</option>
              <option value="Prepaid">Prepaid</option>
              <option value="Partially Paid">Partially Paid</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Fulfil from</label>
            <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="Offline">Offline</option>
              <option value="Virtual">Virtual</option>
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
