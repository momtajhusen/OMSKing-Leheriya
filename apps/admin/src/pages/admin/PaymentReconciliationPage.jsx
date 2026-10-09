import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate } from '../../utils/format';
import { CHANNELS, downloadCsv } from '../../lib/orderMetrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { IndianRupee, Clock, Info, Download, Truck } from 'lucide-react';

const AGEING_THRESHOLD_DAYS = 30;

export default function PaymentReconciliationPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const [channel, setChannel] = useState('all');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const delivered = useMemo(() => orders
    .filter((order) => order.status === 'Delivered')
    .filter((order) => channel === 'all' || order.channel === channel)
    .map((order) => ({ ...order, ageing: dayjs().diff(dayjs(order.createdAt), 'day') }))
    .sort((a, b) => b.ageing - a.ageing), [orders, channel]);

  const byChannel = CHANNELS.map((name) => {
    const rows = orders.filter((order) => order.status === 'Delivered' && order.channel === name);
    return { channel: name, count: rows.length, value: rows.reduce((sum, order) => sum + (Number(order.total) || 0), 0) };
  });

  const expected = delivered.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const codCount = delivered.filter((order) => order.paymentMode === 'COD').length;
  const aged = delivered.filter((order) => order.ageing > AGEING_THRESHOLD_DAYS).length;

  const exportExpected = () => {
    downloadCsv(`expected-settlement-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Order', 'Channel', 'Marketplace order id', 'Payment', 'Order date', 'Order value', 'Ageing days'],
      delivered.map((order) => [order.id, order.channel, order.externalOrderId, order.paymentMode, String(order.createdAt || '').slice(0, 10), order.total, order.ageing]));
  };

  if (!loaded) return <PageLoader label="Loading payments..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Payment Reconciliation</h1>
          <p className="text-muted-foreground">
            Delivered orders are money the marketplace or COD courier still owes. Match them against settlement files when those come in.
          </p>
        </div>
        <Button variant="outline" onClick={exportExpected} disabled={!delivered.length}>
          <Download className="w-4 h-4 mr-2" />
          Export expected (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Delivered orders" value={delivered.length} icon={Truck} />
        <KpiCard label="Order value (gross)" value={formatINR(expected)} icon={IndianRupee} />
        <KpiCard label="COD orders" value={codCount} icon={IndianRupee} />
        <KpiCard label={`Older than ${AGEING_THRESHOLD_DAYS} days`} value={aged} icon={Clock} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By channel</CardTitle>
          <CardDescription>Gross order value. Commission, shipping fee and TCS are deducted by the marketplace in its settlement.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Order value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byChannel.map((row) => (
                <TableRow key={row.channel} className="cursor-pointer" onClick={() => setChannel(row.channel)}>
                  <TableCell className="font-medium">{row.channel}</TableCell>
                  <TableCell className="text-right">{row.count}</TableCell>
                  <TableCell className="text-right">{formatINR(row.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Awaiting settlement ({delivered.length})</CardTitle>
            <CardDescription>Oldest first.</CardDescription>
          </div>
          <Select className="w-40" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {CHANNELS.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </CardHeader>
        <CardContent>
          {delivered.length === 0 ? (
            <EmptyState title="No delivered orders" description="Delivered orders show here until they are settled." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Marketplace ID</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead className="text-right">Order value</TableHead>
                    <TableHead>Ageing</TableHead>
                    <TableHead>Settlement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delivered.map((order) => (
                    <TableRow key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>
                      <TableCell className="font-medium text-primary">{order.id}</TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{order.externalOrderId || '—'}</TableCell>
                      <TableCell>{order.paymentMode}</TableCell>
                      <TableCell>{order.createdAt ? formatDate(order.createdAt) : '—'}</TableCell>
                      <TableCell className="text-right">{formatINR(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant={order.ageing > AGEING_THRESHOLD_DAYS ? 'destructive' : 'secondary'}>{order.ageing} d</Badge>
                      </TableCell>
                      <TableCell><span className="text-sm text-muted-foreground">No file matched</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Not connected yet</p>
              <p>Amazon / Myntra settlement file import and courier invoice recon (weight, COD remittance, RTO charges) are not built. Until then this page lists what should be paid; nothing here is marked as settled.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
