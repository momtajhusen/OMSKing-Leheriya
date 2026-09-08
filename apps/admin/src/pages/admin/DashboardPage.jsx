import { useState } from 'react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { dashboardSeries } from '../../mocks';
import { formatINR } from '../../utils/format';
import KpiCard from '../../components/ui/KpiCard';
import Button from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import { TrendingUp, TrendingDown, Package, ShoppingCart, Truck, RotateCcw, AlertTriangle, Clock } from 'lucide-react';

const COLORS = ['#0F172A', '#D97706', '#1E3A8A', '#F59E0B', '#3B82F6'];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('all');
  const { kpi, ordersTrend, revenueByChannel, orderStatusDistribution, lowStockProducts, recentOrders, recentActivity } = dashboardSeries;

  const filteredOrders = activeTab === 'all' 
    ? recentOrders 
    : recentOrders.filter(order => {
        const statusMap = {
          'new': 'Pending',
          'processing': 'Processing',
          'pending': 'Pending',
          'dispatched': 'Shipped',
          'delivered': 'Delivered'
        };
        return statusMap[activeTab] === order.status;
      });

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your order management operations</p>
      </div>

      {/* Status Tabs */}
      <div className="flex items-center gap-2">
        <Button variant={activeTab === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('all')}>All</Button>
        <Button variant={activeTab === 'new' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('new')}>New</Button>
        <Button variant={activeTab === 'processing' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('processing')}>Processing</Button>
        <Button variant={activeTab === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('pending')}>Pending</Button>
        <Button variant={activeTab === 'dispatched' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('dispatched')}>Dispatched</Button>
        <Button variant={activeTab === 'delivered' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('delivered')}>Delivered</Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Revenue"
          value={formatINR(kpi.revenue.value)}
          delta={kpi.revenue.delta}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <KpiCard
          label="Orders"
          value={kpi.orders.value}
          delta={kpi.orders.delta}
          icon={<ShoppingCart className="w-4 h-4" />}
        />
        <KpiCard
          label="Fulfillment Rate"
          value={`${kpi.fulfillmentRate.value}%`}
          delta={kpi.fulfillmentRate.delta}
          icon={<Package className="w-4 h-4" />}
        />
        <KpiCard
          label="Return Rate"
          value={`${kpi.returnRate.value}%`}
          delta={kpi.returnRate.delta}
          icon={<RotateCcw className="w-4 h-4" />}
        />
        <KpiCard
          label="RTO Rate"
          value={`${kpi.rtoRate.value}%`}
          delta={kpi.rtoRate.delta}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KpiCard
          label="Avg Shipment Days"
          value={kpi.avgShipmentDays.value}
          delta={kpi.avgShipmentDays.delta}
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orders Trend Line Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Orders Trend (Last 14 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={ordersTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="shopify" stroke="#0F172A" name="Shopify" />
                <Line type="monotone" dataKey="amazon" stroke="#D97706" name="Amazon" />
                <Line type="monotone" dataKey="myntra" stroke="#1E3A8A" name="Myntra" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Order Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Order Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={orderStatusDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {orderStatusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Channel */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Channel (Current Month)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueByChannel}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="channel" />
              <YAxis />
              <Tooltip formatter={(value) => formatINR(value)} />
              <Legend />
              <Bar dataKey="revenue" fill="#0F172A" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Bottom Row - Tables and Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Low Stock Products */}
        <Card>
          <CardHeader>
            <CardTitle>Low Stock Alert</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockProducts.map((product) => (
                  <tr key={product.id}>
                    <TableCell>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground">{product.sku}</div>
                    </TableCell>
                    <TableCell>{product.stock}</TableCell>
                    <TableCell>
                      <Badge variant={product.status === 'Critical' ? 'destructive' : 'secondary'}>
                        {product.status}
                      </Badge>
                    </TableCell>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
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
                {filteredOrders.slice(0, 5).map((order, index) => (
                  <tr key={order.id}>
                    <TableCell className="font-medium">{order.id}</TableCell>
                    <TableCell>
                      <div>{order.customer}</div>
                      <div className="text-xs text-muted-foreground">{order.channel}</div>
                    </TableCell>
                    <TableCell>{formatINR(order.value)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.status}</Badge>
                    </TableCell>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 mt-2 rounded-full bg-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{activity.type}</p>
                    <p className="text-xs text-muted-foreground">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{activity.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}