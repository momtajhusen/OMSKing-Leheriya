import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import useReturnsStore, { EMPTY_WORKFLOW } from '../../stores/returnsStore';
import useAuthStore from '../../stores/authStore';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import { RotateCcw, ClipboardCheck, CheckCircle, XCircle, RefreshCw, AlertTriangle, PackageCheck, Truck } from 'lucide-react';

import { CHANNEL_CATALOG, orderChannelLabel } from '../../constants/channelCatalog';
import Pagination, { useClientPage } from '../../components/ui/Pagination';

const RESTOCK_DESTINATIONS = ['All', ...CHANNEL_CATALOG.map((channel) => orderChannelLabel(channel)), 'None'];

function trackingOf(order) {
  return order.awb || (order.channelLines || []).find((line) => line.trackingNumber)?.trackingNumber || '';
}

/** Parcel left the warehouse (has an AWB) and the order was then cancelled or marked RTO by the channel. */
function isRto(order) {
  if (order.channelStatus === 'RTO') return true;
  return order.status === 'Cancelled' && Boolean(trackingOf(order));
}

export default function RtoPage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const workflow = useReturnsStore((s) => (tenantId && s.workflowByTenant?.[tenantId]) || EMPTY_WORKFLOW);
  const setWorkflow = useReturnsStore((s) => s.setWorkflow);
  const [activeTab, setActiveTab] = useState('All');
  const [restockChoices, setRestockChoices] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const rows = useMemo(() => orders.filter(isRto).map((order) => {
    const id = `RTO-${order.id}`;
    const state = workflow[id] || {};
    const reason = (order.channelLines || []).find((line) => line.cancellationReason)?.cancellationReason || order.channelStatus || 'Cancelled after dispatch';
    return {
      id,
      order,
      awb: trackingOf(order),
      courier: order.courier || '',
      reason,
      status: state.status || 'QC Pending',
      qcResult: state.qcResult || '',
      restockDestination: state.restockDestination || '',
    };
  }).sort((a, b) => String(b.order.createdAt).localeCompare(String(a.order.createdAt))), [orders, workflow]);

  const filtered = rows.filter((row) => activeTab === 'All' || row.status === activeTab);
  const paged = useClientPage(filtered);

  const qcPass = async (row) => {
    const destination = restockChoices[row.id] || 'All';
    setBusy(row.id);
    try {
      if (destination !== 'None') {
        await api.post('/returns/approve-restock', {
          returnId: row.id,
          referenceId: row.id,
          destination,
          movementType: 'rto_restock',
          warehouseCode: 'WH-001',
          items: (row.order.items || []).map((item) => ({ sku: item.sku, qty: item.qty || 1 })),
          reason: `RTO ${row.order.id} QC passed`,
        });
      }
      setWorkflow(row.id, { status: 'QC Complete', qcResult: destination === 'None' ? 'No restock' : 'Restock', restockDestination: destination });
      toast.success(destination === 'None' ? `${row.id} QC passed, not restocked` : `${row.id} QC passed and restocked to WH-001`);
    } catch (err) {
      toast.error(apiError(err, 'Restock failed'));
    } finally {
      setBusy('');
    }
  };

  const qcFail = (row) => {
    setWorkflow(row.id, { status: 'QC Complete', qcResult: 'Rejected', restockDestination: 'None' });
    toast.success(`${row.id} QC failed — no restock`);
  };

  if (!loaded) return <PageLoader label="Loading RTO..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">RTO</h1>
          <p className="text-muted-foreground">Orders that were cancelled after an AWB was issued, so the parcel comes back. Receive, QC and restock here.</p>
        </div>
        <Button variant="outline" onClick={async () => { await hydrateFromApi(); toast.success('RTO list refreshed from orders'); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync RTO
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Total RTO" value={rows.length} icon={RotateCcw} onClick={() => setActiveTab('All')} />
        <KpiCard label="QC Pending" value={rows.filter((row) => row.status === 'QC Pending').length} icon={AlertTriangle} onClick={() => setActiveTab('QC Pending')} />
        <KpiCard label="QC Complete" value={rows.filter((row) => row.status === 'QC Complete').length} icon={ClipboardCheck} onClick={() => setActiveTab('QC Complete')} />
        <KpiCard label="Restocked" value={rows.filter((row) => row.qcResult === 'Restock').length} icon={PackageCheck} />
      </div>

      <div className="flex gap-2">
        {['All', 'QC Pending', 'QC Complete'].map((tab) => (
          <Button key={tab} variant={activeTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab)}>
            {tab}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RTO Shipments ({filtered.length})</CardTitle>
          <CardDescription>QC status is saved in this browser. Restock posts to the inventory ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No RTO shipments" description="An order shows here when it is cancelled after its AWB was issued." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>AWB</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Order date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>QC Result</TableHead>
                    <TableHead>Restock</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.rows.map((row) => {
                    const pending = row.status === 'QC Pending';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/orders/${encodeURIComponent(row.order.id)}`)}>
                            {row.order.id}
                          </button>
                        </TableCell>
                        <TableCell><ItemThumbs items={row.order.items} /></TableCell>
                        <TableCell><Badge variant="outline">{row.order.channel}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{row.awb}</TableCell>
                        <TableCell className="max-w-[260px] text-sm">{row.reason}</TableCell>
                        <TableCell>{row.order.createdAt ? formatDate(row.order.createdAt) : '—'}</TableCell>
                        <TableCell><Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge></TableCell>
                        <TableCell>{row.qcResult ? <Badge variant="outline">{row.qcResult}</Badge> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          {pending ? (
                            <Select className="w-32" value={restockChoices[row.id] || 'All'} onChange={(e) => setRestockChoices((prev) => ({ ...prev, [row.id]: e.target.value }))}>
                              {RESTOCK_DESTINATIONS.map((dest) => <option key={dest} value={dest}>{dest === 'None' ? 'No restock' : dest}</option>)}
                            </Select>
                          ) : (
                            <Badge variant="secondary">{row.restockDestination || 'None'}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {pending ? (
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => qcPass(row)}>
                                <CheckCircle className="w-4 h-4 mr-1" />
                                QC Passed
                              </Button>
                              <Button variant="outline" size="sm" className="text-destructive" onClick={() => qcFail(row)}>
                                <XCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <Badge variant="outline">QC Closed</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination page={paged.page} total={paged.total} limit={paged.limit} onPage={paged.setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium mb-1">RTO Flow</p>
              <p className="text-sm text-muted-foreground">
                Delivery failure or cancellation after dispatch → parcel returns → receive at warehouse → QC → restock or reject.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
