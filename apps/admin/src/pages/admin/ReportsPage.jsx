import { useState } from 'react';
import { reports } from '../../mocks';
import { formatINR } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { BarChart3, Download, Upload, TrendingUp, Package, Truck, RotateCcw, RefreshCw, Store } from 'lucide-react';

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('sales');

  const tabs = [
    { id: 'sales', label: 'Sales', icon: TrendingUp },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'shipping', label: 'Shipping', icon: Truck },
    { id: 'returns', label: 'Returns', icon: RotateCcw },
    { id: 'reconciliation', label: 'Reconciliation', icon: RefreshCw },
    { id: 'vendors', label: 'Vendors', icon: Store },
  ];

  const renderSalesTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">{formatINR(reports.sales.summary.totalRevenue)}</p>
            <p className="text-xs text-green-600">+{reports.sales.summary.growth}% vs last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold">{reports.sales.summary.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Order Value</p>
            <p className="text-2xl font-bold">{formatINR(reports.sales.summary.avgOrderValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Growth Rate</p>
            <p className="text-2xl font-bold">{reports.sales.summary.growth}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Channel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.sales.tableData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{row.orders}</TableCell>
                  <TableCell>{formatINR(row.revenue)}</TableCell>
                  <TableCell><Badge variant="outline">{row.channel}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const renderInventoryTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Stock</p>
            <p className="text-2xl font-bold">{reports.inventory.summary.totalStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Available</p>
            <p className="text-2xl font-bold">{reports.inventory.summary.availableStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Reserved</p>
            <p className="text-2xl font-bold">{reports.inventory.summary.reservedStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Stock Value</p>
            <p className="text-2xl font-bold">{formatINR(reports.inventory.summary.stockValue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Warehouse Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.inventory.warehouseData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.warehouse}</TableCell>
                  <TableCell>{row.stock}</TableCell>
                  <TableCell>{formatINR(row.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const renderShippingTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Shipments</p>
            <p className="text-2xl font-bold">{reports.shipping.summary.totalShipments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Delivered</p>
            <p className="text-2xl font-bold">{reports.shipping.summary.delivered}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">In Transit</p>
            <p className="text-2xl font-bold">{reports.shipping.summary.inTransit}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Delivery Time</p>
            <p className="text-2xl font-bold">{reports.shipping.summary.avgDeliveryTime} days</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Courier Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead>Shipments</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Avg Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.shipping.courierData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.courier}</TableCell>
                  <TableCell>{row.shipments}</TableCell>
                  <TableCell>{row.delivered}</TableCell>
                  <TableCell>{row.avgTime} days</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const renderReturnsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Returns</p>
            <p className="text-2xl font-bold">{reports.returns.summary.totalReturns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Approved</p>
            <p className="text-2xl font-bold">{reports.returns.summary.approved}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Rejected</p>
            <p className="text-2xl font-bold">{reports.returns.summary.rejected}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Return Rate</p>
            <p className="text-2xl font-bold">{reports.returns.summary.returnRate}%</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Return Reasons</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Percentage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.returns.reasonData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.reason}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell>{row.percentage}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const renderReconciliationTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Shopify Reconciliation</CardTitle>
            <CardDescription>Excludes Paid/Cancelled orders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Orders</span>
                <span className="font-medium">{reports.reconciliation.shopify.totalOrders}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reconciled</span>
                <span className="font-medium text-green-600">{reports.reconciliation.shopify.reconciled}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pending</span>
                <span className="font-medium text-yellow-600">{reports.reconciliation.shopify.pending}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mismatched</span>
                <span className="font-medium text-destructive">{reports.reconciliation.shopify.mismatched}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold">{formatINR(reports.reconciliation.shopify.amount)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Amazon/Myntra Reconciliation</CardTitle>
            <CardDescription>Upload payment files for reconciliation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Settlements</span>
                <span className="font-medium">{reports.reconciliation.amazonMyntra.totalSettlements}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Matched</span>
                <span className="font-medium text-green-600">{reports.reconciliation.amazonMyntra.matched}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Underpaid</span>
                <span className="font-medium text-yellow-600">{reports.reconciliation.amazonMyntra.underpaid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Missing</span>
                <span className="font-medium text-destructive">{reports.reconciliation.amazonMyntra.missing}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold">{formatINR(reports.reconciliation.amazonMyntra.amount)}</span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Button variant="outline" className="w-full">
                <Upload className="w-4 h-4 mr-2" />
                Upload Payment File
              </Button>
              <Button variant="outline" className="w-full">
                <Upload className="w-4 h-4 mr-2" />
                Upload Return File
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead>Return Status</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.reconciliation.tableData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.orderId}</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={row.paymentStatus === 'Paid' ? 'outline' : 'destructive'}>
                      {row.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.returnStatus}</TableCell>
                  <TableCell>{formatINR(row.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  const renderVendorsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Vendors</p>
            <p className="text-2xl font-bold">{reports.vendors.summary.totalVendors}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active</p>
            <p className="text-2xl font-bold">{reports.vendors.summary.activeVendors}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold">{reports.vendors.summary.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">{formatINR(reports.vendors.summary.totalRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>Shipped</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.vendors.tableData.map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{row.vendor}</TableCell>
                  <TableCell>{row.orders}</TableCell>
                  <TableCell>{row.pending}</TableCell>
                  <TableCell>{row.shipped}</TableCell>
                  <TableCell>{row.delivered}</TableCell>
                  <TableCell>{formatINR(row.revenue)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="text-yellow-500">★</span>
                      <span>{row.rating}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Reports</h1>
          <p className="text-muted-foreground">Comprehensive business analytics and insights</p>
        </div>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export All
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
              activeTab === tab.id 
                ? 'border-primary text-primary' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'sales' && renderSalesTab()}
      {activeTab === 'inventory' && renderInventoryTab()}
      {activeTab === 'shipping' && renderShippingTab()}
      {activeTab === 'returns' && renderReturnsTab()}
      {activeTab === 'reconciliation' && renderReconciliationTab()}
      {activeTab === 'vendors' && renderVendorsTab()}
    </div>
  );
}