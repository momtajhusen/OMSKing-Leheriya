import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api, { apiError } from '../../lib/api';
import useAuthStore from '../../stores/authStore';
import useChannelStore from '../../stores/channelStore';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { relativeTime } from '../../lib/orderMetrics';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import KpiCard from '../../components/ui/KpiCard';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import { FieldLabel } from '../../components/ui/TableToolbar';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import ProductThumb from '../../components/ui/ProductThumb';
import { TrendingUp, Package, ShoppingCart, Truck, RotateCcw, AlertTriangle, Clock } from 'lucide-react';

const COLORS = ['#7C3AED', '#D97706', '#2563EB', '#10B981', '#F43F5E', '#64748B'];
const CHANNEL_STROKES = ['#7C3AED', '#D97706', '#2563EB', '#059669', '#DB2777', '#0891B2', '#CA8A04'];

const STATUS_TABS = ['all', 'New', 'Processing', 'Pending', 'Dispatched', 'Delivered'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [range, setRange] = useState('all');
  const tenantName = useAuthStore((s) => s.user?.tenantName || '');
  const statusError = useChannelStore((s) => s.statusError);
  const [lowStock, setLowStock] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState('');
  const connected = useConnectedChannels();

  const trendChannels = channelFilter === 'all'
    ? connected.channels
    : connected.channels.filter((channel) => orderChannelLabel(channel) === channelFilter);
  const channelKey = connected.labels.join(',');
  const trendKey = trendChannels.map((channel) => `${channel.id}:${orderChannelLabel(channel)}`).join(',');

  useEffect(() => {
    api.get('/inventory/alerts').then(({ data }) => setLowStock(data.data || [])).catch(() => setLowStock([]));
    api.get('/integrations/jobs').then(({ data }) => setJobs((data.data || []).slice(0, 6))).catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    if (!connected.loaded) return undefined;
    let cancel = false;
    api.get('/orders/summary', {
      params: {
        connected: statusError ? undefined : (channelKey || '__none__'),
        channelIds: trendChannels.map((channel) => channel.id).join(','),
        channelLabels: trendChannels.map((channel) => orderChannelLabel(channel)).join(','),
        channel: channelFilter,
        days: range,
        tzOffset: new Date().getTimezoneOffset(),
      },
    }).then(({ data }) => {
      if (cancel) return;
      setSummary(data.data || null);
      setLoadError('');
    }).catch((err) => {
      if (!cancel) setLoadError(apiError(err, 'Could not load dashboard'));
    });
    return () => { cancel = true; };
  }, [connected.loaded, channelKey, trendKey, channelFilter, range, statusError]);

  const stats = summary && {
    newOrders: summary.newOrders,
    shipping: summary.awaitingDispatch,
    returns: summary.returns,
    missingInvoice: summary.missingInvoice,
    revenue: summary.revenue,
    channels: summary.channels || [],
    statuses: summary.statuses || [],
    trend: summary.trend || [],
    top: summary.top || [],
  };
  const orderCount = summary?.total || 0;
  const recentOrders = summary?.recent?.[activeTab] || [];
  const pulseCount = (tab) => summary?.counts?.[tab] || 0;

  if (!summary) {
    return loadError
      ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      : <PageLoader label="Loading dashboard..." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {tenantName ? `${tenantName} · ` : ''}{orderCount} orders from connected channels
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          <FieldLabel label="Filters">
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <Select className="h-9 w-full sm:w-40" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} aria-label="Channel">
                <option value="all">All channels</option>
                {connected.labels.map((label) => <option key={label} value={label}>{label}</option>)}
              </Select>
              <Select className="h-9 w-full sm:w-36" value={range} onChange={(event) => setRange(event.target.value)} aria-label="Period">
                <option value="all">All time</option>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
              </Select>
            </div>
          </FieldLabel>
          <Button variant="outline" className="h-9" onClick={() => navigate('/orders')}>View all orders</Button>
        </div>
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

      {orderCount === 0 ? (
        <EmptyState
          title={channelFilter !== 'all' || range !== 'all' ? 'Nothing in this filter' : 'No orders yet'}
          description={channelFilter !== 'all' || range !== 'all' ? 'Choose another channel or period.' : 'Connect a channel and run Sync Orders on the Orders page.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Orders Trend ({range === 'all' ? 'Last 14 Days' : `Last ${range} Days`})</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={stats.trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    {trendChannels.map((channel, index) => (
                      <Line
                        key={channel.id}
                        type="monotone"
                        dataKey={channel.id}
                        name={orderChannelLabel(channel)}
                        stroke={CHANNEL_STROKES[index % CHANNEL_STROKES.length]}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Order Status</CardTitle>
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
              <CardTitle>Revenue by Channel (excluding cancelled)</CardTitle>
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Top Selling SKUs</CardTitle>
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
                          <ProductThumb name={sku.name || sku.sku} sku={sku.sku} src={sku.imageUrl} />
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
            <CardTitle>Recent Orders</CardTitle>
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
            <CardTitle>Channel sync activity</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/integrations')}>Open</Button>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <EmptyState title="No sync jobs yet" description="Order pulls and webhooks show here." />
            ) : (
              <div className="space-y-4">
                {jobs.filter((job) => connected.ids.includes(String(job.channel || '').toLowerCase())).map((job) => (
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
