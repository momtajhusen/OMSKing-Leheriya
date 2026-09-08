import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { rto } from '../../mocks';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import { RotateCcw, ClipboardCheck, CheckCircle, XCircle, RefreshCw, AlertTriangle, PackageCheck, Truck } from 'lucide-react';

const RESTOCK_DESTINATIONS = ['All', 'Shopify (Offline)', 'Amazon', 'Myntra', 'None'];

export default function RtoPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [restockChoices, setRestockChoices] = useState({});

  const statusTabs = ['All', 'QC Pending', 'QC Complete'];

  const handleRestockChange = (rtoId, destination) => {
    setRestockChoices(prev => ({
      ...prev,
      [rtoId]: destination,
    }));
  };

  const handleQcPassed = (rtoId) => {
    toast.success(`${rtoId} QC pass — restock ${restockChoices[rtoId] || 'All'}`);
  };

  const handleReject = (rtoId) => {
    toast.success(`${rtoId} QC fail — no restock`);
  };

  const filteredRto = rto.filter(item => activeTab === 'All' || item.status === activeTab);

  const kpiData = {
    total: rto.length,
    qcPending: rto.filter(item => item.status === 'QC Pending').length,
    qcComplete: rto.filter(item => item.status === 'QC Complete').length,
    restocked: rto.filter(item => item.qcResult === 'Restock').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">RTO</h1>
          <p className="text-muted-foreground">Return-to-origin shipments — receipt, QC and restock</p>
        </div>
        <Button variant="outline" onClick={() => console.log('Syncing RTO shipments')}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync RTO
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total RTO</p>
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
                <p className="text-sm text-muted-foreground">QC Pending</p>
                <p className="text-2xl font-bold">{kpiData.qcPending}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">QC Complete</p>
                <p className="text-2xl font-bold">{kpiData.qcComplete}</p>
              </div>
              <ClipboardCheck className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Restocked</p>
                <p className="text-2xl font-bold">{kpiData.restocked}</p>
              </div>
              <PackageCheck className="w-8 h-8 text-primary" />
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
            {tab}
          </Button>
        ))}
      </div>

      {/* RTO Table */}
      <Card>
        <CardHeader>
          <CardTitle>RTO Shipments ({filteredRto.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RTO ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>AWB</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Received Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>QC Result</TableHead>
                <TableHead>Restock Destination</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRto.map((item) => {
                const isQcPending = item.status === 'QC Pending';
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.id}</TableCell>
                    <TableCell>{item.orderId}</TableCell>
                    <TableCell className="font-mono">{item.awb}</TableCell>
                    <TableCell>{item.courier}</TableCell>
                    <TableCell>{item.reason}</TableCell>
                    <TableCell>{formatDate(item.receivedDate)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(item.status)}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.qcResult ? (
                        <Badge variant="outline">{item.qcResult}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isQcPending ? (
                        <Select
                          className="w-40"
                          value={restockChoices[item.id] || item.restockDestination || 'All'}
                          onChange={(e) => handleRestockChange(item.id, e.target.value)}
                        >
                          {RESTOCK_DESTINATIONS.map((dest) => (
                            <option key={dest} value={dest}>{dest}</option>
                          ))}
                        </Select>
                      ) : (
                        <Badge variant="secondary">{item.restockDestination || 'None'}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isQcPending ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleQcPassed(item.id)}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Mark QC Passed
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive"
                            onClick={() => handleReject(item.id)}
                          >
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
        </CardContent>
      </Card>

      {/* RTO Flow Explainer */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium mb-1">RTO Flow</p>
              <p className="text-sm text-muted-foreground">
                Delivery failure → Return to Origin → Receive at warehouse → QC inspection → Restock or Reject.
                Restock destination is chosen during QC and decides which channel inventory the unit returns to.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
