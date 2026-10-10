import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import dayjs from 'dayjs';
import api, { apiError } from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate } from '../../utils/format';
import { downloadCsv } from '../../lib/orderMetrics';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { IndianRupee, Clock, Download, Truck } from 'lucide-react';

const AGEING_THRESHOLD_DAYS = 30;

export default function PaymentReconciliationPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const [channel, setChannel] = useState('all');
  const connected = useConnectedChannels();
  const [source, setSource] = useState('amazon');
  const [settlement, setSettlement] = useState([]);
  const [courierBill, setCourierBill] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const open = useMemo(() => orders
    .filter((order) => order.status === 'Delivered' || order.status === 'Dispatched')
    .filter((order) => !(order.channel === 'Shopify' && order.paid))
    .map((order) => {
      const ageing = dayjs().diff(dayjs(order.createdAt), 'day');
      return { ...order, ageing, flagged: !order.paid && ageing > AGEING_THRESHOLD_DAYS };
    })
    .sort((a, b) => b.ageing - a.ageing), [orders]);

  const delivered = useMemo(
    () => open.filter((order) => channel === 'all' || order.channel === channel),
    [open, channel],
  );

  const byChannel = connected.labels.map((name) => {
    const rows = open.filter((order) => order.channel === name);
    return { channel: name, count: rows.length, value: rows.reduce((sum, order) => sum + (Number(order.total) || 0), 0) };
  });

  const expected = delivered.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const codCount = delivered.filter((order) => order.paymentMode === 'COD').length;
  const aged = delivered.filter((order) => order.flagged).length;

  const readFile = (file, onText) => {
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const uploadSettlement = async (csv) => {
    setBusy('settlement');
    try {
      const { data } = await api.post('/finance/settlements', { source, csv });
      setSettlement(data.data?.rows || []);
      const exceptions = (data.data?.rows || []).filter((row) => row.status === 'exception').length;
      toast.success(exceptions ? `${exceptions} settlement line${exceptions === 1 ? '' : 's'} need a look` : 'Settlement lines matched');
    } catch (err) {
      toast.error(apiError(err, 'Settlement file was not matched'));
    } finally {
      setBusy('');
    }
  };

  const uploadCourier = async (csv) => {
    setBusy('courier');
    try {
      const { data } = await api.post('/finance/courier-bills', { csv });
      setCourierBill(data.data?.rows || []);
      const exceptions = (data.data?.rows || []).filter((row) => row.status === 'exception').length;
      toast.success(exceptions ? `${exceptions} courier line${exceptions === 1 ? '' : 's'} are exceptions` : 'Courier bill matched on weight');
    } catch (err) {
      toast.error(apiError(err, 'Courier bill was not checked'));
    } finally {
      setBusy('');
    }
  };

  const markPaid = async (order) => {
    setBusy(order.id);
    try {
      await api.post(`/orders/${encodeURIComponent(order.id)}/payment`);
      await hydrateFromApi();
      toast.success(`${order.id} marked paid`);
    } catch (err) {
      toast.error(apiError(err, 'Could not mark the payment'));
    } finally {
      setBusy('');
    }
  };

  const exportExpected = () => {
    downloadCsv(`expected-settlement-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Order', 'Channel', 'Marketplace order id', 'Payment', 'Order date', 'Order value', 'Ageing days'],
      delivered.map((order) => [order.id, order.channel, order.externalOrderId, order.paymentMode, String(order.createdAt || '').slice(0, 10), order.total, order.ageing]));
  };

  if (!loaded) return <PageLoader label="Loading payments..." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Payment Reconciliation</h1>
          <p className="text-muted-foreground">
            Fulfilled orders stay here while payment is unpaid. Shopify paid and cancelled orders are left out. A fulfilled order is not treated as paid.
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
            <CardDescription>Oldest first. Unpaid for more than 30 days is flagged. Partially paid stays until you mark it paid.</CardDescription>
          </div>
          <Select className="w-40" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {connected.labels.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </CardHeader>
        <CardContent>
          {delivered.length === 0 ? (
            <EmptyState title="No delivered orders" description="Delivered orders show here until they are settled." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
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
                      <TableCell>{order.paymentLabel || order.paymentMode}</TableCell>
                      <TableCell>{order.createdAt ? formatDate(order.createdAt) : '—'}</TableCell>
                      <TableCell className="text-right">{formatINR(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant={order.flagged ? 'destructive' : 'secondary'}>
                          {order.flagged ? `Unpaid ${order.ageing}d` : `${order.ageing} d`}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        {settlement.find((row) => row.orderNo === order.id)?.label === 'Payment Received' && <Badge variant="outline">Payment Received</Badge>}
                        {settlement.find((row) => row.orderNo === order.id)?.status === 'exception' && <Badge variant="destructive">Exception</Badge>}
                        {!settlement.find((row) => row.orderNo === order.id) && <span className="text-sm text-muted-foreground">No file matched</span>}
                        {order.channel === 'Shopify' && !order.paid && (
                          <Button className="ml-2" size="sm" variant="outline" disabled={busy === order.id} onClick={() => markPaid(order)}>Mark paid</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marketplace settlement file</CardTitle>
          <CardDescription>CSV columns: order, gross, commission, shipping, fees, tcs, tds, refunds, net. Expected net is gross minus those deductions. A mismatch stays an exception.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select className="w-40" value={source} onChange={(e) => setSource(e.target.value)}>
              {connected.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{orderChannelLabel(channel)}</option>
              ))}
            </Select>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy === 'settlement'}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file, uploadSettlement);
                event.target.value = '';
              }}
            />
          </div>
          {settlement.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Expected net</TableHead>
                  <TableHead className="text-right">File net</TableHead>
                  <TableHead>Exception</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlement.map((row) => (
                  <TableRow key={`${row.key}-${row.orderNo || 'none'}`}>
                    <TableCell className="font-mono text-xs">{row.orderNo || row.key}</TableCell>
                    <TableCell><Badge variant={row.label === 'Payment Received' ? 'outline' : 'destructive'}>{row.label || row.status}</Badge></TableCell>
                    <TableCell className="text-right">{formatINR(row.expected)}</TableCell>
                    <TableCell className="text-right">{formatINR(row.net)}</TableCell>
                    <TableCell className="text-sm">{row.exception || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Courier freight bill</CardTitle>
          <CardDescription>Separate from marketplace settlement. Columns: awb, charged_weight, declared_weight, cod, rto, ndr, surcharge, amount. A higher charged weight is an exception.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy === 'courier'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file, uploadCourier);
              event.target.value = '';
            }}
          />
          {courierBill.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AWB</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Charged kg</TableHead>
                  <TableHead className="text-right">Declared kg</TableHead>
                  <TableHead>Exception</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courierBill.map((row) => (
                  <TableRow key={row.awb || row.exception}>
                    <TableCell className="font-mono text-xs">{row.awb || '—'}</TableCell>
                    <TableCell><Badge variant={row.status === 'matched' ? 'outline' : 'destructive'}>{row.status}</Badge></TableCell>
                    <TableCell className="text-right">{row.chargedWeight}</TableCell>
                    <TableCell className="text-right">{row.declaredWeight}</TableCell>
                    <TableCell className="text-sm">{row.exception || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
