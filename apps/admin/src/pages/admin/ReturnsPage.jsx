import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import useReturnsStore from '../../stores/returnsStore';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { RotateCcw, Package, CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { ItemThumbs } from '../../components/ui/ProductThumb';

export default function ReturnsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [selectedReturns, setSelectedReturns] = useState({});
  const [receiveFor, setReceiveFor] = useState(null);
  const [receiveWarehouse, setReceiveWarehouse] = useState('WH-001');
  const [receiveAction, setReceiveAction] = useState('restock');
  const returns = useReturnsStore((s) => s.returns);
  const approveReturn = useReturnsStore((s) => s.approveReturn);
  const rejectReturn = useReturnsStore((s) => s.rejectReturn);
  const markReceived = useReturnsStore((s) => s.markReceived);
  const printReverseLabel = useReturnsStore((s) => s.printReverseLabel);
  const syncFromOrders = useReturnsStore((s) => s.syncFromOrders);
  const orders = useOrderStore((s) => s.orders);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

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
    toast.success(
      dest === 'None'
        ? `Return ${returnId} approved — no restock`
        : `Return ${returnId} approved. Qty added to Offline WH-001.`
    );
  };

  const confirmReceived = () => {
    if (!receiveFor) return;
    markReceived(receiveFor.id, { warehouse: receiveWarehouse, action: receiveAction });
    toast.success(
      receiveAction === 'none'
        ? `${receiveFor.id} received — no restock (hold/dispose)`
        : `${receiveFor.id} received — inventory ledger +${receiveAction === 'restock' ? 'qty' : 'QC hold'} at ${receiveWarehouse}`
    );
    setReceiveFor(null);
  };

  const handleRejectReturn = (returnId) => {
    rejectReturn(returnId);
    toast.success(`Return ${returnId} rejected`);
  };

  const statusTabs = ['all', 'pending', 'approved', 'rejected', 'completed'];

  const filteredReturns = useMemo(() => returns.filter((ret) => (
    activeTab === 'all' || ret.status.toLowerCase() === activeTab
  )), [returns, activeTab]);

  const kpiData = {
    total: returns.length,
    pending: returns.filter((r) => r.status === 'Pending').length,
    approved: returns.filter((r) => r.status === 'Approved').length,
    rejected: returns.filter((r) => r.status === 'Rejected').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Returns</h1>
          <p className="text-muted-foreground">Customer returns and reverse pickups. Approve adds qty to Offline WH-001 and the same ATS goes to Amazon and Myntra.</p>
        </div>
        <Button variant="outline" onClick={async () => { await hydrateFromApi(); toast.success('Returns refreshed from orders'); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync Returns
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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

      {/* Status Tabs */}
      <div className="flex gap-2">
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
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Package className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Restock Destination Configuration</p>
              <p className="text-sm text-muted-foreground">
                Configure where returned items should be restocked. Options include all warehouses, 
                specific channels (Shopify Offline, Amazon, Myntra), or no restock.
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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                    No returns yet. A return shows here when a reverse pickup is booked on an order or a channel sends a return.
                  </TableCell>
                </TableRow>
              )}
              {filteredReturns.map((ret) => {
                return (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">
                      <div>{ret.id}</div>
                      {ret.type === 'reverse_pickup' && <Badge variant="outline">Reverse pickup</Badge>}
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
                          {['All', 'Shopify (Offline)', 'Amazon', 'Myntra', 'None'].map((dest) => (
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
        </CardContent>
      </Card>

      {/* Restock Legend */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="font-medium mb-3">Restock Destination Options</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">All</p>
                <p className="text-muted-foreground">Add qty to Offline WH-001. Amazon and Myntra ATS use the same warehouse, so both marketplaces get the stock.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Shopify (Offline)</p>
                <p className="text-muted-foreground">Restock to Shopify offline warehouse only</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Amazon/Myntra</p>
                <p className="text-muted-foreground">Restock to marketplace warehouses</p>
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
        description="Spec: on Received, choose restock destination so ATS updates. Dummy write for now."
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
            <label className="block">
              <span className="text-muted-foreground">Warehouse</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={receiveWarehouse}
                onChange={(e) => setReceiveWarehouse(e.target.value)}
              >
                <option value="WH-001">WH-001 physical (Shopify A + Amazon + Myntra)</option>
                <option value="WH-002">WH-002 virtual (Shopify B only)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-muted-foreground">Action</span>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                value={receiveAction}
                onChange={(e) => setReceiveAction(e.target.value)}
              >
                <option value="restock">QC pass — restock sellable</option>
                <option value="hold">QC hold — do not sell yet</option>
                <option value="none">Do not restock</option>
              </select>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}