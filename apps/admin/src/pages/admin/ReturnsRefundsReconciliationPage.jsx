import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useOrderStore from '../../stores/orderStore';
import useReturnsStore from '../../stores/returnsStore';
import { formatINR, formatDate } from '../../utils/format';
import { CHANNELS } from '../../lib/orderMetrics';
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
  const workflow = useReturnsStore((s) => s.workflow);
  const [tab, setTab] = useState('all');

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

  const summary = CHANNELS.map((channel) => {
    const list = rows.filter((row) => row.order.channel === channel);
    return { channel, total: list.length, awaiting: list.filter((row) => row.shipped && !row.received).length };
  });

  if (!loaded) return <PageLoader label="Loading refunds..." />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Returns &amp; Refunds Reconciliation</h1>
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
            <CardContent className="pt-6">
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
          <CardDescription>"Received" comes from Returns (marked received) and RTO (QC closed).</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="Nothing in this view" />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
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
                        {!row.shipped ? <Badge variant="secondary">Never shipped</Badge>
                          : row.received ? <Badge variant="outline">Received</Badge>
                            : <Badge variant="destructive">Not back</Badge>}
                      </TableCell>
                      <TableCell className="text-right">{row.refund ? formatINR(row.refund) : '—'}</TableCell>
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
            <p className="text-sm text-muted-foreground">
              Marketplace refunds are paid by Amazon / Myntra and recovered in their settlement. Matching against their return / refund files is not built yet.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
