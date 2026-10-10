import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import useReturnsStore, { EMPTY_WORKFLOW } from '../../stores/returnsStore';
import useAuthStore from '../../stores/authStore';
import { formatINR, formatDate } from '../../utils/format';
import useConnectedChannels from '../../hooks/useConnectedChannels';
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

function hasTracking(order) {
  return Boolean(order.awb || (order.channelLines || []).some((line) => line.trackingNumber));
}

export default function ReturnsRefundsReconciliationPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const workflow = useReturnsStore((s) => (tenantId && s.workflowByTenant?.[tenantId]) || EMPTY_WORKFLOW);
  const [tab, setTab] = useState('all');
  const [returnFile, setReturnFile] = useState([]);
  const [busy, setBusy] = useState(false);
  const connected = useConnectedChannels();

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const rows = useMemo(() => orders.flatMap((order) => {
    if (order.reversePickup?.returnId) {
      const state = workflow[order.reversePickup.returnId] || {};
      return [{
        key: order.reversePickup.returnId,
        order,
        kind: 'Customer return',
        shipped: true,
        received: state.status === 'Completed',
        refund: order.total,
      }];
    }
    if (order.status !== 'Cancelled') return [];
    const shipped = hasTracking(order);
    const state = workflow[`RTO-${order.id}`] || {};
    return [{
      key: order.id,
      order,
      kind: shipped ? 'Cancelled after dispatch (RTO)' : 'Cancelled before dispatch',
      shipped,
      received: !shipped || state.status === 'QC Complete',
      refund: order.paymentMode === 'COD' ? 0 : order.total,
    }];
  }).sort((a, b) => String(b.order.createdAt).localeCompare(String(a.order.createdAt))), [orders, workflow]);

  const filtered = rows.filter((row) => {
    if (tab === 'awaiting') return row.shipped && !row.received;
    if (tab === 'received') return row.shipped && row.received;
    if (tab === 'refund') return row.refund > 0;
    return true;
  });

  const summary = connected.labels.map((channel) => {
    const list = rows.filter((row) => row.order.channel === channel);
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Cancellations + returns" value={rows.length} icon={RotateCcw} onClick={() => setTab('all')} />
        <KpiCard label="Parcel not back" value={rows.filter((row) => row.shipped && !row.received).length} icon={Clock} onClick={() => setTab('awaiting')} />
        <KpiCard label="Return received" value={rows.filter((row) => row.shipped && row.received).length} icon={PackageCheck} onClick={() => setTab('received')} />
        <KpiCard label="Prepaid refunds" value={formatINR(rows.reduce((sum, row) => sum + row.refund, 0))} icon={AlertTriangle} onClick={() => setTab('refund')} />
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
