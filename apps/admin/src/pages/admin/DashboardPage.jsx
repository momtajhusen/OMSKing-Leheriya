import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { dashboardSeries } from '../../mocks';
import { formatINR } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import KpiCard from '../../components/ui/KpiCard';
import Button from '../../components/ui/Button';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import { TrendingUp, Package, ShoppingCart, Truck, RotateCcw, AlertTriangle, Clock } from 'lucide-react';

const COLORS = ['#7C3AED', '#D97706', '#2563EB', '#10B981', '#F43F5E'];

const STATUS_TABS = ['all', 'New', 'Processing', 'Pending', 'Dispatched', 'Delivered'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const loading = useSimulatedLoad(activeTab);
  const {
    kpi, ordersTrend, revenueByChannel, orderStatusDistribution,
    lowStockProducts, recentOrders, recentActivity, topSellingSkus,
  } = dashboardSeries;

  const filteredOrders = activeTab === 'all'
    ? recentOrders
    : recentOrders.filter((order) => order.status === activeTab);

  if (loading) return <PageLoader label="Loading dashboard..." />;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Leheriya Creations · Shopify, Amazon, Myntra · shipping, new orders, returns, pending invoices</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/orders')}>View all orders</Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
            className="text-xs whitespace-nowrap"
          >
            {tab === 'all' ? 'All' : tab}
          </Button>
        ))}
      </div>

      <div className="kpi-grid">
        <KpiCard label="New Orders" value={kpi.newOrders.value} delta={kpi.newOrders.delta} icon={ShoppingCart} tone="emerald" onClick={() => setActiveTab('New')} />
        <KpiCard label="Shipping" value={kpi.shippingPending.value} delta={kpi.shippingPending.delta} icon={Truck} tone="sky" onClick={() => navigate('/shipping')} />
        <KpiCard label="Return Issues" value={kpi.returnIssues.value} delta={kpi.returnIssues.delta} icon={RotateCcw} tone="rose" onClick={() => navigate('/returns')} />
        <KpiCard label="Problem Invoices" value={kpi.problemInvoices.value} delta={kpi.problemInvoices.delta} icon={AlertTriangle} tone="orange" onClick={() => navigate('/gst-invoice')} />
        <KpiCard label="Net Sales" value={formatINR(kpi.revenue.value)} delta={kpi.revenue.delta} icon={TrendingUp} tone="violet" onClick={() => navigate('/reports')} />
        <KpiCard label="Amazon" value={formatINR(kpi.amazonSales.value)} delta={kpi.amazonSales.delta} icon={Package} tone="amber" onClick={() => navigate('/reports')} />
        <KpiCard label="Myntra" value={formatINR(kpi.myntraSales.value)} delta={kpi.myntraSales.delta} icon={Package} tone="rose" onClick={() => navigate('/reports')} />
        <KpiCard label="Low Stock" value={lowStockProducts.length} icon={Clock} tone="slate" onClick={() => navigate('/inventory')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Orders Trend (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={ordersTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="shopify" stroke="#7C3AED" name="Shopify" />
                <Line type="monotone" dataKey="amazon" stroke="#D97706" name="Amazon" />
                <Line type="monotone" dataKey="myntra" stroke="#2563EB" name="Myntra" />
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
                  data={orderStatusDistribution}
                  nameKey="status"
                  dataKey="count"
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={70}
                >
                  {orderStatusDistribution.map((entry, index) => (
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
          <CardTitle className="text-lg sm:text-xl">Revenue by Channel (Current Month)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={revenueByChannel}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => formatINR(value)} />
              <Bar dataKey="revenue" fill="#7C3AED" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg sm:text-xl">Top Selling SKUs</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/products')}>Open</Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSellingSkus.map((sku) => (
                  <TableRow key={sku.sku} className="cursor-pointer" onClick={() => navigate('/products')}>
                    <TableCell>
                      <div className="font-medium">{sku.name}</div>
                      <div className="text-xs text-muted-foreground">{sku.sku}</div>
                    </TableCell>
                    <TableCell>{sku.units}</TableCell>
                    <TableCell><Badge variant="outline">{sku.channel}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg sm:text-xl">Recent Orders</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>Open</Button>
          </CardHeader>
          <CardContent>
            {filteredOrders.length === 0 ? (
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
                  {filteredOrders.slice(0, 5).map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate('/orders')}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>
                        <div>{order.customer}</div>
                        <div className="text-xs text-muted-foreground">{order.channel}</div>
                      </TableCell>
                      <TableCell>{formatINR(order.value)}</TableCell>
                      <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg sm:text-xl">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-[hsl(var(--color-muted))]/50"
                  onClick={() => navigate(activity.type.includes('Return') ? '/returns' : '/orders')}
                >
                  <div className="w-2 h-2 mt-2 rounded-full bg-primary" />
                  <div className="flex-1">
                    <p className="text-xs sm:text-sm font-medium">{activity.type}</p>
                    <p className="text-xs text-muted-foreground">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{activity.timestamp}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
