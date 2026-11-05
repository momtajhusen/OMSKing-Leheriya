import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useReturnsStore from '../../stores/returnsStore';
import { CLAIM_STATUSES, REFUND_STATUSES, claimName, claimText, kindOf, refundText, splitByKind } from '../../lib/returnClaims';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { RotateCcw, Package, CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { ItemThumbs } from '../../components/ui/ProductThumb';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import Pagination, { useClientPage } from '../../components/ui/Pagination';

export default function ReturnsPage() {
  const connected = useConnectedChannels();
  const restockDestinations = [
    'All',
    ...connected.channels.map((channel) => (channel.id === 'shopify' ? 'Shopify (Offline)' : orderChannelLabel(channel))),
    'None',
  ];
  const [activeTab, setActiveTab] = useState('all');
  const [selectedReturns, setSelectedReturns] = useState({});
  const [receiveFor, setReceiveFor] = useState(null);
  const [receiveWarehouse, setReceiveWarehouse] = useState('WH-001');
  const [receiveAction, setReceiveAction] = useState('restock');
  const [qcNote, setQcNote] = useState('');
  const [kindTab, setKindTab] = useState('customer');
  const [claimFor, setClaimFor] = useState(null);
  const [claimForm, setClaimForm] = useState({ status: 'none', claimId: '', amount: '', note: '', refundStatus: 'pending', refundAmount: '' });
  const saveClaim = useReturnsStore((s) => s.saveClaim);
  const saveRefund = useReturnsStore((s) => s.saveRefund);
  const returns = useReturnsStore((s) => s.returns);
  const approveReturn = useReturnsStore((s) => s.approveReturn);
  const rejectReturn = useReturnsStore((s) => s.rejectReturn);
  const markReceived = useReturnsStore((s) => s.markReceived);
  const printReverseLabel = useReturnsStore((s) => s.printReverseLabel);
  const syncFromOrders = useReturnsStore((s) => s.syncFromOrders);
  const loadReturns = useReturnsStore((s) => s.loadReturns);
  const orders = useOrderStore((s) => s.orders);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);

  useEffect(() => {
    hydrateFromApi();
    loadReturns();
  }, [hydrateFromApi, loadReturns]);

  useEffect(() => {
    syncFromOrders(orders);
  }, [orders, syncFromOrders]);

  const handleRestockChange = (returnId, destination) => {
    setSelectedReturns((prev) => ({
      ...prev,
      [returnId]: destination,
    }));
  };

  const handleApproveReturn = async (returnId) => {
    const dest = selectedReturns[returnId] || 'All';
    const next = await approveReturn(returnId, dest);
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(`Return ${returnId} approved. Print the label. Stock updates when the parcel is received.`);
  };

  const confirmReceived = async () => {
    if (!receiveFor) return;
    const destination = receiveAction === 'restock' ? (selectedReturns[receiveFor.id] || receiveFor.restockDestination || 'All') : 'None';
    const next = await markReceived(receiveFor.id, { warehouse: receiveWarehouse, action: receiveAction, destination, qcNote });
    if (next?.error) {
      toast.error(next.error);
      return;
    }
    toast.success(
      receiveAction === 'restock' && destination !== 'None'
        ? `${receiveFor.id} received. WH-001 stock and ${destination} ATS updated.`
        : receiveAction === 'damaged' && claimName(next?.claim?.type)
          ? `${receiveFor.id} received as QC fail. ${claimName(next.claim.type)} is ready to file.`
          : `${receiveFor.id} received. Stock was not added.`
    );
    setReceiveFor(null);
  };

  const openClaim = (ret) => {
    setClaimFor(ret);
    setClaimForm({
      status: ret.claim?.status || 'none',
      claimId: ret.claim?.claimId || '',
      amount: ret.claim?.amount || '',
      note: ret.claim?.note || '',
      refundStatus: ret.refundStatus || 'pending',
      refundAmount: ret.refundAmount || '',
    });
  };

  const saveClaimForm = async () => {
    if (!claimFor) return;
    if (claimName(claimFor.claim?.type)) {
      const claim = await saveClaim(claimFor.id, { status: claimForm.status, claimId: claimForm.claimId, amount: claimForm.amount, note: claimForm.note });
      if (claim?.error) { toast.error(claim.error); return; }
    }
    const refund = await saveRefund(claimFor.id, { status: claimForm.refundStatus, amount: claimForm.refundAmount });
    if (refund?.error) { toast.error(refund.error); return; }
    toast.success(`${claimFor.id} saved`);
    setClaimFor(null);
  };

  const handleRejectReturn = (returnId) => {
    rejectReturn(returnId);
    toast.success(`Return ${returnId} rejected`);
  };

  const statusTabs = ['all', 'pending', 'approved', 'rejected', 'completed'];

  const byKind = useMemo(() => splitByKind(returns), [returns]);
  const filteredReturns = useMemo(() => byKind[kindTab].filter((ret) => (
    activeTab === 'all' || ret.status.toLowerCase() === activeTab
  )), [byKind, kindTab, activeTab]);
  const paged = useClientPage(filteredReturns);

  const kpiData = {
    total: returns.length,
    pending: returns.filter((r) => r.status === 'Pending').length,
    approved: returns.filter((r) => r.status === 'Approved').length,
    rejected: returns.filter((r) => r.status === 'Rejected').length,
  };

  return (
    <div className="space-y-3">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Returns</h1>
          <p className="text-muted-foreground">Customer returns and reverse pickups. Approve adds qty to Offline WH-001 and the same ATS goes to Amazon and Myntra.</p>
        </div>
        <Button variant="outline" onClick={async () => { await hydrateFromApi(); await loadReturns(); toast.success('Returns refreshed'); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync Returns
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Returns</p>
                <p className="text-2xl font-bold">{kpiData.total}</p>
              </div>
              <RotateCcw className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{kpiData.pending}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold">{kpiData.approved}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-bold">{kpiData.rejected}</p>
              </div>
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[['customer', 'Customer returns'], ['rto', 'RTO']].map(([kind, label]) => (
          <Button key={kind} variant={kindTab === kind ? 'default' : 'outline'} onClick={() => setKindTab(kind)}>
            {label} ({byKind[kind].length})
          </Button>
        ))}
        <span className="text-sm text-muted-foreground">
          RTO = the courier could not deliver and the parcel comes back. Courier RTO orders are also on the <Link to="/rto" className="underline">RTO page</Link>.
        </span>
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2">
        {statusTabs.map(tab => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
      </div>

      {/* Restock Destination Info */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <Package className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Restock Destination Configuration</p>
              <p className="text-sm text-muted-foreground">
                Returned units go back to Offline WH-001. All raises every connected channel{connected.labels.length ? `: ${connected.labels.join(', ')}` : ''}.
                One channel raises only that channel. None leaves stock unchanged.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle>Return Requests ({filteredReturns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Restock Destination</TableHead>
                <TableHead>QC · Refund · Claim</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-muted-foreground">
                    No returns yet. A return shows here when a reverse pickup is booked on an order or a channel sends a return.
                  </TableCell>
                </TableRow>
              )}
              {paged.rows.map((ret) => {
                return (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">
                      <div>{ret.id}</div>
                      {ret.type === 'reverse_pickup' && <Badge variant="outline">Reverse pickup</Badge>}
                      {kindOf(ret) === 'rto' && <Badge variant="outline">RTO</Badge>}
                    </TableCell>
                    <TableCell>{ret.orderId}</TableCell>
                    <TableCell><ItemThumbs items={ret.items} /></TableCell>
                    <TableCell>{ret.customer}</TableCell>
                    <TableCell>{ret.reason}</TableCell>
                    <TableCell>{formatDate(ret.requestDate)}</TableCell>
                    <TableCell>{formatINR(ret.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(ret.status)}>
                        {ret.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ret.status === 'Pending' ? (
                        <div className="space-y-1">
                          {restockDestinations.map((dest) => (
                            <label key={dest} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`restock-${ret.id}`}
                                value={dest}
                                checked={(selectedReturns[ret.id] || 'All') === dest}
                                onChange={() => handleRestockChange(ret.id, dest)}
                                className="w-4 h-4"
                              />
                              {dest}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {ret.restockDestination || 'Not specified'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ret.source === 'api' ? (
                        <div className="space-y-1">
                          <div>QC: {ret.qcStatus === 'pending' ? 'not checked' : ret.qcStatus}{ret.qcNote ? ` · ${ret.qcNote}` : ''}</div>
                          <div className="text-muted-foreground">{refundText(ret)}</div>
                          {claimText(ret.claim) && <Badge variant="outline">{claimText(ret.claim)}</Badge>}
                          <Button size="sm" variant="ghost" onClick={() => openClaim(ret)}>
                            {claimName(ret.claim?.type) ? 'Claim & refund' : 'Refund'}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {ret.status === 'Pending' && (
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleApproveReturn(ret.id)}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="text-destructive"
                            onClick={() => handleRejectReturn(ret.id)}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                      {ret.status === 'Approved' && (
                        <div className="flex flex-col gap-2">
                          <Badge variant="outline">{ret.type === 'reverse_pickup' ? 'Reverse pickup' : 'QC / inbound'}</Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const order = useOrderStore.getState().getById(ret.orderId);
                              printReverseLabel(ret, order);
                              toast.success(`${ret.type === 'reverse_pickup' ? 'Reverse pickup' : 'Return'} label opened for ${ret.id}`);
                            }}
                          >
                            {ret.type === 'reverse_pickup' ? 'Generate reverse label' : 'Return label'}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setReceiveFor(ret);
                              setReceiveWarehouse('WH-001');
                              setReceiveAction('restock');
                              setQcNote('');
                            }}
                          >
                            <Package className="w-4 h-4 mr-1" />
                            Mark received
                          </Button>
                        </div>
                      )}
                      {ret.status === 'Completed' && (
                        <Badge variant="outline">Restocked</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={paged.page} total={paged.total} limit={paged.limit} onPage={paged.setPage} />
        </CardContent>
      </Card>

      {/* Restock Legend */}
      <Card>
        <CardContent className="p-3">
          <h3 className="font-medium mb-3">Restock Destination Options</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">All</p>
                <p className="text-muted-foreground">Add the unit to shared offline stock. Shopify, Amazon and Myntra ATS all rise.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Shopify (Offline)</p>
                <p className="text-muted-foreground">Add the unit to Offline WH-001 for Shopify only. Amazon and Myntra stay the same.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Amazon/Myntra</p>
                <p className="text-muted-foreground">Add the unit for that marketplace only. The other channels do not receive it.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-destructive mt-0.5" />
              <div>
                <p className="font-medium">None</p>
                <p className="text-muted-foreground">Do not restock (dispose or hold)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(receiveFor)}
        onOpenChange={(open) => { if (!open) setReceiveFor(null); }}
        title="Received — inventory"
        description="Received stock goes to Offline WH-001. A single channel raises only that channel's ATS."
        footer={
          <>
            <Button variant="outline" onClick={() => setReceiveFor(null)}>Cancel</Button>
            <Button onClick={confirmReceived}>Post to inventory ledger</Button>
          </>
        }
      >
        {receiveFor && (
          <div className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Return</span> {receiveFor.id} · order {receiveFor.orderId}</p>
            <p className="text-muted-foreground">Warehouse: Offline WH-001. Virtual WH-002 is not a restock destination.</p>
            <label className="block">
              <span className="text-muted-foreground">Action</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={receiveAction}
                onChange={(e) => setReceiveAction(e.target.value)}
              >
                <option value="restock">QC pass — restock sellable</option>
                <option value="hold">QC hold — do not sell yet</option>
                <option value="damaged">QC fail — damaged or wrong item (no restock, open claim)</option>
                <option value="none">Do not restock</option>
              </select>
            </label>
            {receiveAction !== 'restock' && (
              <label className="block">
                <span className="text-muted-foreground">QC note (what is wrong)</span>
                <Input className="mt-1" value={qcNote} onChange={(e) => setQcNote(e.target.value)} placeholder="e.g. Torn fabric, used, wrong item" />
              </label>
            )}
            {receiveAction === 'damaged' && claimName(receiveFor.claim?.type) && (
              <p className="text-muted-foreground">A {claimName(receiveFor.claim.type)} is marked To file. File it on the {receiveFor.claim.type === 'safet' ? 'Amazon Seller Central SAFE-T' : 'Myntra partner portal'} page, then save the claim ID here.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(claimFor)}
        onOpenChange={(open) => { if (!open) setClaimFor(null); }}
        title={claimFor ? `${claimName(claimFor.claim?.type) ? 'Claim & refund' : 'Refund'} · ${claimFor.id}` : ''}
        description={claimName(claimFor?.claim?.type)
          ? `${claimName(claimFor.claim.type)}s are filed on the ${claimFor.claim.type === 'safet' ? 'Amazon Seller Central SAFE-T' : 'Myntra partner portal'} page. Save the claim ID and result here to track it.`
          : 'Track the refund for this return.'}
        footer={
          <>
            <Button variant="outline" onClick={() => setClaimFor(null)}>Cancel</Button>
            <Button onClick={saveClaimForm}>Save</Button>
          </>
        }
      >
        {claimFor && (
          <div className="space-y-3 text-sm">
            {claimName(claimFor.claim?.type) && (
              <>
                <label className="block">
                  <span className="text-muted-foreground">{claimName(claimFor.claim.type)} status</span>
                  <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={claimForm.status} onChange={(e) => setClaimForm({ ...claimForm, status: e.target.value })}>
                    {CLAIM_STATUSES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-muted-foreground">Claim ID</span>
                  <Input className="mt-1" value={claimForm.claimId} onChange={(e) => setClaimForm({ ...claimForm, claimId: e.target.value })} placeholder="ID from the portal" />
                </label>
                <label className="block">
                  <span className="text-muted-foreground">Claim amount (₹)</span>
                  <Input className="mt-1" type="number" min="0" value={claimForm.amount} onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-muted-foreground">Note</span>
                  <Input className="mt-1" value={claimForm.note} onChange={(e) => setClaimForm({ ...claimForm, note: e.target.value })} />
                </label>
              </>
            )}
            <label className="block">
              <span className="text-muted-foreground">Refund status</span>
              <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={claimForm.refundStatus} onChange={(e) => setClaimForm({ ...claimForm, refundStatus: e.target.value })}>
                {REFUND_STATUSES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-muted-foreground">Refund amount (₹)</span>
              <Input className="mt-1" type="number" min="0" value={claimForm.refundAmount} onChange={(e) => setClaimForm({ ...claimForm, refundAmount: e.target.value })} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}