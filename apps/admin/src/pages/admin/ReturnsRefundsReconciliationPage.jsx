import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import useReturnsStore, { EMPTY_WORKFLOW } from '../../stores/returnsStore';
import useAuthStore from '../../stores/authStore';
import { formatINR, formatDate } from '../../utils/format';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import { filterReturnRows } from '../../lib/reportFilters';
import { refundRows, sumMoney } from '../../lib/orderMetrics';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { RotateCcw, PackageCheck, Clock, AlertTriangle, Info } from 'lucide-react';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'awaiting', label: 'Parcel not back' },
  { id: 'received', label: 'Return received' },
  { id: 'refund', label: 'Refund due (prepaid)' },
];

export default function ReturnsRefundsReconciliationPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const workflow = useReturnsStore((s) => (tenantId && s.workflowByTenant?.[tenantId]) || EMPTY_WORKFLOW);
  const [returnRows, setReturnRows] = useState([]);
  const [tab, setTab] = useState('all');
  const [channelFilter, setChannelFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [returnFile, setReturnFile] = useState([]);
  const [busy, setBusy] = useState(false);
  const connected = useConnectedChannels();

  useEffect(() => {
    hydrateFromApi();
    api.get('/returns').then(({ data }) => setReturnRows(data.data || [])).catch(() => setReturnRows([]));
  }, [hydrateFromApi]);

  const rows = useMemo(() => refundRows(orders, workflow, returnRows), [orders, workflow, returnRows]);

  const kinds = useMemo(() => [...new Set(rows.map((row) => row.kind))].sort(), [rows]);
  const payments = useMemo(() => [...new Set(rows.map((row) => row.order.paymentMode).filter(Boolean))].sort(), [rows]);
  const scoped = useMemo(
    () => filterReturnRows(rows, { channel: channelFilter, kind: kindFilter, payment: paymentFilter, from: fromDate, to: toDate }),
    [rows, channelFilter, kindFilter, paymentFilter, fromDate, toDate],
  );
  const hasFilters = Boolean(channelFilter || kindFilter || paymentFilter || fromDate || toDate);
  const clearFilters = () => {
    setChannelFilter('');
    setKindFilter('');
    setPaymentFilter('');
    setFromDate('');
    setToDate('');
  };

  const filtered = scoped.filter((row) => {
    if (tab === 'awaiting') return row.shipped && !row.received;
    if (tab === 'received') return row.shipped && row.received;
    if (tab === 'refund') return row.refund > 0;
    return true;
  });

  const summary = (channelFilter ? [channelFilter] : connected.labels).map((channel) => {
    const list = scoped.filter((row) => row.order.channel === channel);
    return { channel, total: list.length, awaiting: list.filter((row) => row.shipped && !row.received).length };
  });

  const uploadReturnFile = async (file) => {
    const csv = await file.text();
    setBusy(true);
    try {
      const { data } = await api.post('/finance/returns', { csv });
      const rows = data.data?.rows || [];
      setReturnFile(rows);
      const received = rows.filter((row) => row.label === 'Return Received').length;
      toast.success(received ? `${received} return ${received === 1 ? 'line matches' : 'lines match'} a Master Order` : 'No return line matched a Master Order');
    } catch (err) {
      toast.error(apiError(err, 'Return file was not matched'));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <PageLoader label="Loading refunds..." />;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold">Returns &amp; Refunds Reconciliation</h1>
        <p className="text-muted-foreground">
          Every cancellation and return, whether the parcel is back, and whether money goes back to the customer.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <p className="mb-1 text-sm font-medium">Channel</p>
          <Select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="">All channels</option>
            {connected.labels.map((label) => <option key={label} value={label}>{label}</option>)}
          </Select>
        </div>
        <div className="w-56">
          <p className="mb-1 text-sm font-medium">Type</p>
          <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">All types</option>
            {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </Select>
        </div>
        <div className="w-40">
          <p className="mb-1 text-sm font-medium">Payment</p>
          <Select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
            <option value="">All payments</option>
            {payments.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <p className="mb-1 text-sm font-medium">Order date from</p>
          <Input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
        </div>
        <div className="w-44">
          <p className="mb-1 text-sm font-medium">To</p>
          <Input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
        </div>
        {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Cancellations + returns" value={scoped.length} icon={RotateCcw} onClick={() => setTab('all')} />
        <KpiCard label="Parcel not back" value={scoped.filter((row) => row.shipped && !row.received).length} icon={Clock} onClick={() => setTab('awaiting')} />
        <KpiCard label="Return received" value={scoped.filter((row) => row.shipped && row.received).length} icon={PackageCheck} onClick={() => setTab('received')} />
        <KpiCard label="Prepaid refunds" value={formatINR(sumMoney(scoped.map((row) => row.refund)))} icon={AlertTriangle} onClick={() => setTab('refund')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summary.map((row) => (
          <Card key={row.channel}>
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">{row.channel}</p>
              <p className="text-2xl font-bold">{row.total}</p>
              <p className="text-xs text-muted-foreground">{row.awaiting} parcel{row.awaiting === 1 ? '' : 's'} not back yet</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((item) => (
          <Button key={item.id} size="sm" variant={tab === item.id ? 'default' : 'outline'} onClick={() => setTab(item.id)}>{item.label}</Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Records ({filtered.length})</CardTitle>
          <CardDescription>A return file is matched on its own. It is not compared with the payment settlement file.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="Nothing in this view" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead className="text-right">Order value</TableHead>
                    <TableHead>Parcel</TableHead>
                    <TableHead className="text-right">Refund to customer</TableHead>
                    <TableHead>Credit note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.key} className="cursor-pointer" onClick={() => navigate(`/orders/${encodeURIComponent(row.order.id)}`)}>
                      <TableCell className="font-medium text-primary">{row.order.id}</TableCell>
                      <TableCell><Badge variant="outline">{row.order.channel}</Badge></TableCell>
                      <TableCell className="text-sm">{row.kind}</TableCell>
                      <TableCell>{row.order.paymentMode}</TableCell>
                      <TableCell>{row.order.createdAt ? formatDate(row.order.createdAt) : '—'}</TableCell>
                      <TableCell className="text-right">{formatINR(row.order.total)}</TableCell>
                      <TableCell>
                        {returnFile.find((file) => file.orderNo === row.order.id)?.label === 'Return Received'
                          ? <Badge variant="outline">Return Received</Badge>
                          : !row.shipped ? <Badge variant="secondary">Never shipped</Badge>
                            : row.received ? <Badge variant="outline">Received</Badge>
                              : <Badge variant="destructive">Not back</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{row.refund ? formatINR(row.refund) : '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.order.invoiceNo ? `CN-${row.order.invoiceNo}` : '—'}</TableCell>
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
          <CardTitle>Return file</CardTitle>
          <CardDescription>CSV column: order. One row matches one Master Order as Return Received. Payment settlement is not used.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadReturnFile(file);
              event.target.value = '';
            }}
          />
          {returnFile.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Exception</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnFile.map((row) => (
                  <TableRow key={`${row.key}-${row.orderNo || 'none'}`}>
                    <TableCell className="font-mono text-xs">{row.orderNo || row.key}</TableCell>
                    <TableCell><Badge variant={row.label === 'Return Received' ? 'outline' : 'destructive'}>{row.label}</Badge></TableCell>
                    <TableCell className="text-sm">{row.exception || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary mt-0.5" />
            <p className="text-sm text-muted-foreground">
              A credit note uses the invoice number. Marketplace refunds reduce the expected settlement net. The courier freight bill stays on Payment Reconciliation.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
