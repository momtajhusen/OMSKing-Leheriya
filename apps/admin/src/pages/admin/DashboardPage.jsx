import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import useAuthStore from '../../stores/authStore';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import {
  netSales, salesByChannel, statusCounts, ordersTrend, topSkus, isCancelled, relativeTime,
} from '../../lib/orderMetrics';
import { CHANNEL_CATALOG } from '../../constants/channelCatalog';
import KpiCard from '../../components/ui/KpiCard';
import Button from '../../components/ui/Button';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import ProductThumb from '../../components/ui/ProductThumb';
import { TrendingUp, Package, ShoppingCart, Truck, RotateCcw, AlertTriangle, Clock } from 'lucide-react';

const COLORS = ['#7C3AED', '#D97706', '#2563EB', '#10B981', '#F43F5E', '#64748B'];

const STATUS_TABS = ['all', 'New', 'Processing', 'Pending', 'Dispatched', 'Delivered'];
const AWAITING_DISPATCH = ['Processing', 'Packed', 'Ready to Ship'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const loadError = useOrderStore((s) => s.error);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const tenantName = useAuthStore((s) => s.user?.tenantName || '');
  const [lowStock, setLowStock] = useState([]);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    hydrateFromApi();
    api.get('/inventory/alerts').then(({ data }) => setLowStock(data.data || [])).catch(() => setLowStock([]));
    api.get('/integrations/jobs').then(({ data }) => setJobs((data.data || []).slice(0, 6))).catch(() => setJobs([]));
  }, [hydrateFromApi]);

  const stats = useMemo(() => {
    const live = orders.filter((order) => !isCancelled(order));
    const channels = salesByChannel(orders);
    return {
      newOrders: orders.filter((order) => order.status === 'New').length,
      shipping: orders.filter((order) => AWAITING_DISPATCH.includes(order.status)).length,
      returns: orders.filter((order) => order.reversePickup?.returnId).length,
      missingInvoice: live.filter((order) => ['Dispatched', 'Delivered'].includes(order.status) && !order.invoiceNo).length,
      revenue: netSales(orders),
      channels,
      statuses: statusCounts(orders),
      trend: ordersTrend(orders, 14),
      top: topSkus(orders, 5),
    };
  }, [orders]);

  const pendingPulse = (order) => order.status === 'Pending'
    || (order.subOrders || []).some((sub) => sub.vendorStatus === 'Pending Acceptance');

  const recentOrders = useMemo(() => [...orders]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter((order) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'Pending') return pendingPulse(order);
      return order.status === activeTab;
    })
    .slice(0, 5), [orders, activeTab]);

  const pulseCount = (tab) => {
    if (tab === 'all') return orders.length;
    if (tab === 'Pending') return orders.filter(pendingPulse).length;
    return orders.filter((order) => order.status === tab).length;
  };

  if (!loaded) return <PageLoader label="Loading dashboard..." />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {tenantName ? `${tenantName} · ` : ''}{orders.length} orders from connected channels
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/orders')}>View all orders</Button>
      </div>

      {loadError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
            className="text-xs whitespace-nowrap"
          >
            {tab === 'all' ? `All ${pulseCount('all')}` : `${tab} ${pulseCount(tab)}`}
          </Button>
        ))}
      </div>

      <div className="kpi-grid">
        <KpiCard label="New Orders" value={stats.newOrders} icon={ShoppingCart} tone="emerald" onClick={() => setActiveTab('New')} />
        <KpiCard label="Awaiting dispatch" value={stats.shipping} icon={Truck} tone="sky" onClick={() => navigate('/shipping')} />
        <KpiCard label="Returns" value={stats.returns} icon={RotateCcw} tone="rose" onClick={() => navigate('/returns')} />
        <KpiCard label="Shipped, no invoice" value={stats.missingInvoice} icon={AlertTriangle} tone="orange" onClick={() => navigate('/gst-invoice')} />
        <KpiCard label="Net Sales" value={formatINR(stats.revenue)} icon={TrendingUp} tone="violet" onClick={() => navigate('/reports')} />
        {stats.channels.map((row) => (
          <KpiCard key={row.channel} label={row.channel} value={formatINR(row.revenue)} icon={Package} onClick={() => navigate('/orders')} />
        ))}
        <KpiCard label="Low Stock" value={lowStock.length} icon={Clock} tone="slate" onClick={() => navigate('/inventory')} />
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No orders yet" description="Connect a channel and run Sync Orders on the Orders page." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Orders Trend (Last 14 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={stats.trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    {CHANNEL_CATALOG.map((channel, index) => (
                      <Line
                        key={channel.id}
                        type="monotone"
                        dataKey={channel.id}
                        name={channel.name}
                        stroke={['#7C3AED', '#D97706', '#2563EB', '#059669', '#DB2777', '#0891B2', '#CA8A04'][index % 7]}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Order Status</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={stats.statuses}
                      nameKey="status"
                      dataKey="count"
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={70}
                    >
                      {stats.statuses.map((entry, index) => (
                        <Cell key={entry.status} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Revenue by Channel (excluding cancelled)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.channels}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatINR(value)} />
                  <Bar dataKey="revenue" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg sm:text-xl">Top Selling SKUs</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/products')}>Open</Button>
          </CardHeader>
          <CardContent>
            {stats.top.length === 0 ? (
              <EmptyState title="No sales yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Units</TableHead>
                    <TableHead>Channel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.top.map((sku) => (
                    <TableRow key={sku.sku} className="cursor-pointer" onClick={() => navigate('/products')}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProductThumb name={sku.name || sku.sku} src={sku.imageUrl} />
                          <div>
                            <div className="font-medium">{sku.name}</div>
                            <div className="text-xs text-muted-foreground">{sku.sku}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{sku.units}</TableCell>
                      <TableCell><Badge variant="outline">{sku.channel}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg sm:text-xl">Recent Orders</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>Open</Button>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <EmptyState title="No orders in this status" description="Try another tab or open the full orders list." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell>
                        <div>{order.customer}</div>
                        <div className="text-xs text-muted-foreground">{order.channel}</div>
                      </TableCell>
                      <TableCell>{formatINR(order.total)}</TableCell>
                      <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg sm:text-xl">Channel sync activity</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/integrations')}>Open</Button>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <EmptyState title="No sync jobs yet" description="Order pulls and webhooks show here." />
            ) : (
              <div className="space-y-4">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-[hsl(var(--color-muted))]/50"
                    onClick={() => navigate('/integrations')}
                  >
                    <div className={`w-2 h-2 mt-2 rounded-full ${job.status === 'failed' ? 'bg-destructive' : 'bg-primary'}`} />
                    <div className="flex-1">
                      <p className="text-xs sm:text-sm font-medium capitalize">{job.channel} · {String(job.jobType).replace(/_/g, ' ')} · {job.status}</p>
                      <p className="text-xs text-muted-foreground">{job.lastError || job.shortSummary}</p>
                      <p className="text-xs text-muted-foreground mt-1">{relativeTime(job.finishedAt || job.createdAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
