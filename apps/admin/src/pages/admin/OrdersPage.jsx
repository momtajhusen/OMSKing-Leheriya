import { useState } from 'react';
import { orders } from '../../mocks';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import { ShoppingCart, Filter, RefreshCw, Download, Search } from 'lucide-react';

export default function OrdersPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const statusTabs = ['all', 'pending', 'processing', 'awaiting_shipment', 'shipped', 'delivered', 'exceptions'];

  const filteredOrders = orders.filter(order => {
    const matchesTab = activeTab === 'all' || 
      (activeTab === 'pending' && order.status === 'Pending') ||
      (activeTab === 'processing' && order.status === 'Processing') ||
      (activeTab === 'awaiting_shipment' && order.status === 'Awaiting_Shipment') ||
      (activeTab === 'shipped' && order.status === 'Shipped') ||
      (activeTab === 'delivered' && order.status === 'Delivered') ||
      (activeTab === 'exceptions' && ['Return_Requested', 'RTO_In_Transit', 'NDR'].includes(order.status));
    
    const matchesSearch = searchQuery === '' || 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesTab && matchesSearch;
  });

  const kpiData = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'Pending').length,
    processing: orders.filter(o => o.status === 'Processing').length,
    shipped: orders.filter(o => o.status === 'Shipped').length,
    delivered: orders.filter(o => o.status === 'Delivered').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Orders</h1>
          <p className="text-muted-foreground">Manage and track all customer orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Orders
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard label="Total Orders" value={kpiData.total} icon={<ShoppingCart className="w-4 h-4" />} />
        <KpiCard label="Pending" value={kpiData.pending} icon={<Filter className="w-4 h-4" />} />
        <KpiCard label="Processing" value={kpiData.processing} icon={<Filter className="w-4 h-4" />} />
        <KpiCard label="Shipped" value={kpiData.shipped} icon={<Filter className="w-4 h-4" />} />
        <KpiCard label="Delivered" value={kpiData.delivered} icon={<Filter className="w-4 h-4" />} />
      </div>

      {/* Status Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {statusTabs.map(tab => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
          >
            {tab.replace('_', ' ').toUpperCase()}
          </Button>
        ))}
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by order ID or customer name..."
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline">
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Orders ({filteredOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.slice(0, 15).map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.id}</TableCell>
                  <TableCell>
                    <div>{order.customerName}</div>
                    <div className="text-xs text-muted-foreground">{order.location}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{order.channel}</Badge>
                  </TableCell>
                  <TableCell>{order.items.length}</TableCell>
                  <TableCell>{formatINR(order.totalValue)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(order.status)}>
                      {order.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{order.paymentMode}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(order.orderDate)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}