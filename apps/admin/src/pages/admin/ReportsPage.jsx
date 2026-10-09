import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import { vendorReportLabel } from '../../stores/vendorStore';
import { formatINR } from '../../utils/format';
import { netSales, salesByChannel, isCancelled, downloadCsv } from '../../lib/orderMetrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Download, TrendingUp, Package, Truck, RotateCcw, RefreshCw, Store } from 'lucide-react';

const TABS = [
  { id: 'sales', label: 'Sales', icon: TrendingUp },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'shipping', label: 'Shipping', icon: Truck },
  { id: 'returns', label: 'Cancellations', icon: RotateCcw },
  { id: 'reconciliation', label: 'Reconciliation', icon: RefreshCw },
  { id: 'vendors', label: 'Vendors', icon: Store },
];

const monthOf = (value) => String(value || '').slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

function Stat({ label, value }) {
  return (
    <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></CardContent></Card>
  );
}

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const [activeTab, setActiveTab] = useState('sales');
  const [vendorFilter, setVendorFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [stock, setStock] = useState([]);

  useEffect(() => {
    hydrateFromApi();
    api.get('/inventory').then(({ data }) => setStock(data.data?.rows || [])).catch(() => setStock([]));
  }, [hydrateFromApi]);

  const sales = useMemo(() => {
    const live = orders.filter((order) => !isCancelled(order));
    const revenue = netSales(orders);
    const months = {};
    live.forEach((order) => {
      const key = monthOf(order.createdAt);
      if (!key) return;
      months[key] = months[key] || { month: key, revenue: 0, orders: 0 };
      months[key].revenue += Number(order.total) || 0;
      months[key].orders += 1;
    });
    return {
      revenue,
      count: live.length,
      aov: live.length ? Math.round(revenue / live.length) : 0,
      cancelled: orders.length - live.length,
      byMonth: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
      byChannel: salesByChannel(orders),
    };
  }, [orders]);

  const inventory = useMemo(() => {
    const warehouses = {};
    stock.forEach((row) => {
      const w = warehouses[row.warehouse] || { warehouse: row.warehouse, stock: 0, available: 0, reserved: 0, value: 0 };
      w.stock += row.stock || 0;
      w.available += row.available || 0;
      w.reserved += row.reserved || 0;
      w.value += (row.stock || 0) * (row.cost || 0);
      warehouses[row.warehouse] = w;
    });
    const rows = Object.values(warehouses);
    return {
      rows,
      stock: rows.reduce((n, w) => n + w.stock, 0),
      available: rows.reduce((n, w) => n + w.available, 0),
      reserved: rows.reduce((n, w) => n + w.reserved, 0),
      value: rows.reduce((n, w) => n + w.value, 0),
    };
  }, [stock]);

  const shipping = useMemo(() => {
    const shipped = orders.filter((order) => trackingOf(order));
    const couriers = {};
    shipped.forEach((order) => {
      const name = order.courier || `${order.channel} logistics`;
      couriers[name] = couriers[name] || { courier: name, shipments: 0, delivered: 0, cancelled: 0 };
      couriers[name].shipments += 1;
      if (order.status === 'Delivered') couriers[name].delivered += 1;
      if (order.status === 'Cancelled') couriers[name].cancelled += 1;
    });
    return {
      total: shipped.length,
      delivered: shipped.filter((order) => order.status === 'Delivered').length,
      inTransit: shipped.filter((order) => order.status === 'Dispatched').length,
      cancelledAfterDispatch: shipped.filter((order) => order.status === 'Cancelled').length,
      rto: shipped.filter((order) => `${order.channelStatus || ''} ${(order.channelLines || []).map((line) => line.status).join(' ')}`.toUpperCase().includes('RTO') || order.reversePickup?.returnId).length,
      couriers: Object.values(couriers).sort((a, b) => b.shipments - a.shipments),
    };
  }, [orders]);

  const cancellations = useMemo(() => {
    const cancelled = orders.filter(isCancelled);
    const reasons = {};
    cancelled.forEach((order) => {
      const reason = (order.channelLines || []).find((line) => line.cancellationReason)?.cancellationReason || 'No reason given';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    return {
      count: cancelled.length,
      afterDispatch: cancelled.filter((order) => trackingOf(order)).length,
      returns: orders.filter((order) => order.reversePickup?.returnId).length,
      rate: orders.length ? ((cancelled.length / orders.length) * 100).toFixed(1) : '0.0',
      reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count, pct: ((count / cancelled.length) * 100).toFixed(1) })).sort((a, b) => b.count - a.count),
    };
  }, [orders]);

  const vendorLines = useMemo(() => orders.flatMap((order) => (order.subOrders || [])
    .filter((sub) => sub.assignedVendor)
    .map((sub) => ({ order, sub, vendor: vendorReportLabel(sub.assignedVendor), month: monthOf(sub.assignedDate || order.createdAt) }))), [orders]);

  const vendorRows = useMemo(() => {
    const map = {};
    vendorLines.forEach(({ sub, vendor }) => {
      const row = map[vendor] || { vendor, orders: 0, pending: 0, shipped: 0, delivered: 0, value: 0 };
      row.orders += 1;
      if (['Dispatched'].includes(sub.vendorStatus)) row.shipped += 1;
      else if (sub.vendorStatus === 'Delivered') row.delivered += 1;
      else row.pending += 1;
      row.value += Number(sub.price) || 0;
      map[vendor] = row;
    });
    return Object.values(map).sort((a, b) => b.orders - a.orders);
  }, [vendorLines]);

  const vendorMonths = [...new Set(vendorLines.map((line) => line.month).filter(Boolean))].sort().reverse();

  const downloadVendor = (kind) => {
    const lines = vendorLines.filter((line) => (!vendorFilter || line.vendor === vendorFilter) && (!monthFilter || line.month === monthFilter));
    if (!lines.length) {
      toast.error('No rows for these vendor / month filters');
      return;
    }
    if (kind === 'order') {
      downloadCsv(`vendor-orders-${today()}.csv`, ['Vendor', 'Sub-order', 'Master order', 'SKU', 'Title', 'Assign price', 'Vendor status', 'Courier', 'Tracking', 'Assigned', 'Dispatched'],
        lines.map(({ order, sub, vendor }) => [vendor, sub.id, order.id, sub.sku, sub.title, sub.price, sub.vendorStatus, sub.courier, sub.trackingNumber, sub.assignedDate, sub.dispatchDate]));
    } else {
      const key = kind === 'month' ? (line) => `${line.month}|${line.vendor}` : (line) => line.vendor;
      const groups = {};
      lines.forEach((line) => {
        const k = key(line);
        groups[k] = groups[k] || { month: line.month, vendor: line.vendor, lines: 0, value: 0 };
        groups[k].lines += 1;
        groups[k].value += Number(line.sub.price) || 0;
      });
      const header = kind === 'month' ? ['Month', 'Vendor', 'Lines', 'Assign value'] : ['Vendor', 'Lines', 'Assign value'];
      downloadCsv(`vendor-${kind}-${today()}.csv`, header, Object.values(groups).map((g) => (kind === 'month' ? [g.month, g.vendor, g.lines, g.value] : [g.vendor, g.lines, g.value])));
    }
    toast.success('Vendor report downloaded');
  };

  const exportCurrent = () => {
    if (activeTab === 'sales') {
      downloadCsv(`sales-${today()}.csv`, ['Order', 'Date', 'Channel', 'Status', 'Payment', 'Items', 'Total'],
        orders.map((order) => [order.id, String(order.createdAt || '').slice(0, 10), order.channel, order.status, order.paymentMode, (order.items || []).length, order.total]));
    } else if (activeTab === 'inventory') {
      downloadCsv(`inventory-${today()}.csv`, ['SKU', 'Product', 'Warehouse', 'Stock', 'Reserved', 'Available'],
        stock.map((row) => [row.sku, row.productName, row.warehouse, row.stock, row.reserved, row.available]));
    } else if (activeTab === 'shipping') {
      downloadCsv(`shipping-${today()}.csv`, ['Courier', 'Shipments', 'Delivered', 'Cancelled after dispatch'],
        shipping.couriers.map((row) => [row.courier, row.shipments, row.delivered, row.cancelled]));
    } else if (activeTab === 'returns') {
      downloadCsv(`cancellations-${today()}.csv`, ['Reason', 'Count', '%'], cancellations.reasons.map((row) => [row.reason, row.count, row.pct]));
    } else if (activeTab === 'vendors') {
      downloadVendor('vendor');
      return;
    } else {
      navigate('/payment-reconciliation');
      return;
    }
    toast.success(`${TABS.find((tab) => tab.id === activeTab)?.label} report exported`);
  };

  if (!loaded) return <PageLoader label="Loading reports..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Reports</h1>
          <p className="text-muted-foreground">Sales, stock, shipping, cancellations and vendors — all from live orders and the inventory ledger.</p>
        </div>
        <Button variant="outline" onClick={exportCurrent}>
          <Download className="w-4 h-4 mr-2" />
          Export {TABS.find((tab) => tab.id === activeTab)?.label}
        </Button>
      </div>

      <div className="flex gap-2 border-b overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
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
            <Stat label="Net sales (excl. cancelled)" value={formatINR(sales.revenue)} />
            <Stat label="Orders (excl. cancelled)" value={sales.count} />
            <Stat label="Avg order value" value={formatINR(sales.aov)} />
            <Stat label="Cancelled orders" value={sales.cancelled} />
          </div>
          <Card>
            <CardHeader><CardTitle>Revenue by month</CardTitle></CardHeader>
            <CardContent>
              {sales.byMonth.length === 0 ? <EmptyState title="No sales yet" /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={sales.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatINR(value)} />
                    <Bar dataKey="revenue" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>By channel</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/orders')}>Open orders</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Net sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.byChannel.map((row) => (
                    <TableRow key={row.channel}>
                      <TableCell><Badge variant="outline">{row.channel}</Badge></TableCell>
                      <TableCell>{row.orders}</TableCell>
                      <TableCell>{formatINR(row.revenue)}</TableCell>
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
            <Stat label="On hand" value={inventory.stock} />
            <Stat label="Available" value={inventory.available} />
            <Stat label="Reserved" value={inventory.reserved} />
            <Stat label="Stock value (at cost)" value={formatINR(Math.round(inventory.value))} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Warehouse stock</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/inventory')}>Open inventory</Button>
            </CardHeader>
            <CardContent>
              {inventory.rows.length === 0 ? (
                <EmptyState title="No stock posted yet" description="Post stock-in on the Inventory page." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>On hand</TableHead>
                      <TableHead>Reserved</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.rows.map((row) => (
                      <TableRow key={row.warehouse} className="cursor-pointer" onClick={() => navigate('/warehouses')}>
                        <TableCell className="font-medium">{row.warehouse}</TableCell>
                        <TableCell>{row.stock}</TableCell>
                        <TableCell>{row.reserved}</TableCell>
                        <TableCell>{row.available}</TableCell>
                        <TableCell>{formatINR(Math.round(row.value))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'shipping' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Stat label="Shipments (with AWB)" value={shipping.total} />
            <Stat label="Delivered" value={shipping.delivered} />
            <Stat label="In transit" value={shipping.inTransit} />
            <Stat label="Cancelled after dispatch" value={shipping.cancelledAfterDispatch} />
            <Stat label="RTO" value={shipping.rto} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Courier performance</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/shipping')}>Open shipping</Button>
            </CardHeader>
            <CardContent>
              {shipping.couriers.length === 0 ? <EmptyState title="No shipments yet" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Courier</TableHead>
                      <TableHead>Shipments</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Cancelled after dispatch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipping.couriers.map((row) => (
                      <TableRow key={row.courier}>
                        <TableCell className="font-medium">{row.courier}</TableCell>
                        <TableCell>{row.shipments}</TableCell>
                        <TableCell>{row.delivered}</TableCell>
                        <TableCell>{row.cancelled}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'returns' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Stat label="Cancelled" value={cancellations.count} />
            <Stat label="After dispatch (RTO)" value={cancellations.afterDispatch} />
            <Stat label="Customer returns" value={cancellations.returns} />
            <Stat label="Cancellation rate" value={`${cancellations.rate}%`} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Cancellation reasons</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/rto')}>Open RTO</Button>
            </CardHeader>
            <CardContent>
              {cancellations.reasons.length === 0 ? <EmptyState title="No cancellations" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reason</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cancellations.reasons.map((row) => (
                      <TableRow key={row.reason}>
                        <TableCell className="font-medium">{row.reason}</TableCell>
                        <TableCell>{row.count}</TableCell>
                        <TableCell>{row.pct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Delivered orders waiting for marketplace / COD settlement.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/payment-reconciliation')}>Open payments</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Returns &amp; refunds</CardTitle>
              <CardDescription>Cancellations and returns, parcel back or not, refund due.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" variant="outline" onClick={() => navigate('/returns-refunds-reconciliation')}>Open refunds recon</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'vendors' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Stat label="Vendors with lines" value={vendorRows.length} />
            <Stat label="Assigned lines" value={vendorLines.length} />
            <Stat label="Pending at vendor" value={vendorRows.reduce((n, row) => n + row.pending, 0)} />
            <Stat label="Assign value" value={formatINR(vendorRows.reduce((n, row) => n + row.value, 0))} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Download vendor reports</CardTitle>
              <CardDescription>Vendor wise, month wise, or order ID wise CSV. Filters apply to all three.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <p className="mb-1 text-sm font-medium">Vendor</p>
                  <Select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
                    <option value="">All vendors</option>
                    {vendorRows.map((row) => <option key={row.vendor} value={row.vendor}>{row.vendor}</option>)}
                  </Select>
                </div>
                <div className="w-44">
                  <p className="mb-1 text-sm font-medium">Month</p>
                  <Select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
                    <option value="">All months</option>
                    {vendorMonths.map((month) => <option key={month} value={month}>{month}</option>)}
                  </Select>
                </div>
                <Button variant="outline" onClick={() => downloadVendor('vendor')}><Download className="mr-2 h-4 w-4" />Vendor wise</Button>
                <Button variant="outline" onClick={() => downloadVendor('month')}><Download className="mr-2 h-4 w-4" />Month wise</Button>
                <Button onClick={() => downloadVendor('order')}><Download className="mr-2 h-4 w-4" />Order ID wise</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Vendor performance</CardTitle>
                <CardDescription>By vendor name on the order line, so removed vendors still show.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/vendors')}>Open vendors</Button>
            </CardHeader>
            <CardContent>
              {vendorRows.length === 0 ? (
                <EmptyState title="No vendor lines yet" description="Assign sub-orders to vendors on Fulfilment." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Pending</TableHead>
                      <TableHead>Dispatched</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Assign value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendorRows.map((row) => (
                      <TableRow key={row.vendor}>
                        <TableCell className="font-medium">{row.vendor}</TableCell>
                        <TableCell>{row.orders}</TableCell>
                        <TableCell>{row.pending}</TableCell>
                        <TableCell>{row.shipped}</TableCell>
                        <TableCell>{row.delivered}</TableCell>
                        <TableCell>{formatINR(row.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
