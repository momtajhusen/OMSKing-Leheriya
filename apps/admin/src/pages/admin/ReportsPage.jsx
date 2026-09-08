import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { reports } from '../../mocks';
import { formatINR } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import PageLoader from '../../components/ui/PageLoader';
import { BarChart3, Download, Upload, TrendingUp, Package, Truck, RotateCcw, RefreshCw, Store } from 'lucide-react';

const TABS = [
  { id: 'sales', label: 'Sales', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'returns', label: 'Returns', icon: RotateCcw },
  { id: 'reconciliation', label: 'Reconciliation', icon: RefreshCw },
  { id: 'vendors', label: 'Vendors', icon: Store },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('sales');
  const fileRef = useRef(null);
  const [uploadKind, setUploadKind] = useState('payment');
  const loading = useSimulatedLoad(activeTab);

  const exportCurrent = () => {
    toast.success(`${TABS.find((tab) => tab.id === activeTab)?.label} report exported as CSV`);
  };

  const pickFile = (kind) => {
    setUploadKind(kind);
    fileRef.current?.click();
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    toast.success(`${uploadKind === 'payment' ? 'Payment' : 'Return'} file “${file.name}” uploaded`);
  };

  if (loading) return <PageLoader label="Loading reports..." />;

  return (
    <div className="p-6 space-y-6">
      <input ref={fileRef} type="file" className="hidden" accept=".csv,.xlsx" onChange={onFile} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Reports</h1>
          <p className="text-muted-foreground">Leheriya shipping, orders, returns and GST — not a generic P&L brochure.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCurrent}>
            <Download className="w-4 h-4 mr-2" />
            Export {TABS.find((tab) => tab.id === activeTab)?.label}
          </Button>
          <Button variant="outline" onClick={() => toast.success('All report tabs exported')}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Export All
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 whitespace-nowrap transition-colors ${
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

      {activeTab === 'sales' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold">{formatINR(reports.sales.summary.totalRevenue)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Orders</p><p className="text-2xl font-bold">{reports.sales.summary.totalOrders}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Avg Order Value</p><p className="text-2xl font-bold">{formatINR(reports.sales.summary.avgOrderValue)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Growth Rate</p><p className="text-2xl font-bold">{reports.sales.summary.growth}%</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Revenue trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={reports.sales.chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatINR(value)} />
                  <Bar dataKey="revenue" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Sales</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>Open orders</Button>
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
                  {reports.sales.tableData.map((row) => (
                    <TableRow key={`${row.date}-${row.channel}`} className="cursor-pointer" onClick={() => navigate('/orders')}>
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
      )}

      {activeTab === 'inventory' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Stock</p><p className="text-2xl font-bold">{reports.inventory.summary.totalStock}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Available</p><p className="text-2xl font-bold">{reports.inventory.summary.availableStock}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Reserved</p><p className="text-2xl font-bold">{reports.inventory.summary.reservedStock}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Stock Value</p><p className="text-2xl font-bold">{formatINR(reports.inventory.summary.stockValue)}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Warehouse Stock</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/inventory')}>Open inventory</Button>
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
                  {reports.inventory.warehouseData.map((row) => (
                    <TableRow key={row.warehouse} className="cursor-pointer" onClick={() => navigate('/warehouses')}>
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
      )}

      {activeTab === 'shipping' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Shipments</p><p className="text-2xl font-bold">{reports.shipping.summary.totalShipments}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Delivered</p><p className="text-2xl font-bold">{reports.shipping.summary.delivered}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">In Transit</p><p className="text-2xl font-bold">{reports.shipping.summary.inTransit}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Avg Delivery Time</p><p className="text-2xl font-bold">{reports.shipping.summary.avgDeliveryTime} days</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Courier Performance</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/shipping')}>Open shipping</Button>
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
                  {reports.shipping.courierData.map((row) => (
                    <TableRow key={row.courier}>
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
      )}

      {activeTab === 'returns' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Returns</p><p className="text-2xl font-bold">{reports.returns.summary.totalReturns}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Approved</p><p className="text-2xl font-bold">{reports.returns.summary.approved}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Rejected</p><p className="text-2xl font-bold">{reports.returns.summary.rejected}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Return Rate</p><p className="text-2xl font-bold">{reports.returns.summary.returnRate}%</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Return Reasons</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/returns')}>Open returns</Button>
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
                  {reports.returns.reasonData.map((row) => (
                    <TableRow key={row.reason}>
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
      )}

      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Shopify Reconciliation</CardTitle>
                <CardDescription>Excludes Paid/Cancelled orders</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total Orders</span><span className="font-medium">{reports.reconciliation.shopify.totalOrders}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Reconciled</span><span className="font-medium text-green-600">{reports.reconciliation.shopify.reconciled}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pending</span><span className="font-medium text-yellow-600">{reports.reconciliation.shopify.pending}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mismatched</span><span className="font-medium text-destructive">{reports.reconciliation.shopify.mismatched}</span></div>
                <Button className="w-full mt-2" variant="outline" onClick={() => navigate('/payment-reconciliation')}>Open payments</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Amazon/Myntra Reconciliation</CardTitle>
                <CardDescription>Upload payment files for reconciliation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => pickFile('payment')}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Payment File
                </Button>
                <Button variant="outline" className="w-full" onClick={() => pickFile('return')}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Return File
                </Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Reconciliation Details</CardTitle></CardHeader>
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
                  {reports.reconciliation.tableData.map((row) => (
                    <TableRow key={row.orderId} className="cursor-pointer" onClick={() => navigate('/payment-reconciliation')}>
                      <TableCell className="font-medium">{row.orderId}</TableCell>
                      <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                      <TableCell><Badge variant={row.paymentStatus === 'Paid' ? 'outline' : 'destructive'}>{row.paymentStatus}</Badge></TableCell>
                      <TableCell>{row.returnStatus}</TableCell>
                      <TableCell>{formatINR(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'vendors' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Vendors</p><p className="text-2xl font-bold">{reports.vendors.summary.totalVendors}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Active</p><p className="text-2xl font-bold">{reports.vendors.summary.activeVendors}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Orders</p><p className="text-2xl font-bold">{reports.vendors.summary.totalOrders}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold">{formatINR(reports.vendors.summary.totalRevenue)}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Vendor Performance</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/vendors')}>Open vendors</Button>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.vendors.tableData.map((row) => (
                    <TableRow key={row.vendor} className="cursor-pointer" onClick={() => navigate('/vendors')}>
                      <TableCell className="font-medium">{row.vendor}</TableCell>
                      <TableCell>{row.orders}</TableCell>
                      <TableCell>{row.pending}</TableCell>
                      <TableCell>{row.shipped}</TableCell>
                      <TableCell>{row.delivered}</TableCell>
                      <TableCell>{formatINR(row.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
