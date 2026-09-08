import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { ndr } from '../../mocks';
import { formatDate, formatPercent, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { PhoneOff, RefreshCw, AlertTriangle, ArrowUpCircle, CheckCircle, CalendarClock, Truck } from 'lucide-react';

export default function NdrPage() {
  const [activeTab, setActiveTab] = useState('All');
  const [fixItem, setFixItem] = useState(null);
  const [fixPhone, setFixPhone] = useState('');
  const [fixAddress, setFixAddress] = useState('');
  const [customerAction, setCustomerAction] = useState('reattempt');

  const escalationTabs = ['All', 'Pending', 'Active', 'Escalated', 'Closed'];

  const handleReschedule = (item) => {
    setFixItem(item);
    setFixPhone('');
    setFixAddress('');
    setCustomerAction('reattempt');
  };

  const handleEscalate = (ndrId) => {
    toast.success(`${ndrId} escalated`);
  };

  const filteredNdr = ndr.filter(item => activeTab === 'All' || item.escalationStatus === activeTab);

  const kpiData = {
    total: ndr.length,
    active: ndr.filter(item => item.escalationStatus === 'Active').length,
    escalated: ndr.filter(item => item.escalationStatus === 'Escalated').length,
    closed: ndr.filter(item => item.escalationStatus === 'Closed').length,
  };

  const reasonCounts = ndr.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});

  const reasonBreakdown = Object.entries(reasonCounts)
    .map(([reason, count]) => ({
      reason,
      count,
      percent: (count / ndr.length) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const attemptsBadgeVariant = (attempts) => {
    if (attempts >= 3) return 'destructive';
    if (attempts === 2) return 'secondary';
    return 'outline';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">NDR</h1>
          <p className="text-muted-foreground">
            Non-delivery reports — attempt tracking, reattempt scheduling and escalation
          </p>
        </div>
        <Button variant="outline" onClick={() => console.log('Syncing NDR reports')}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync NDR
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total NDR</p>
                <p className="text-2xl font-bold">{kpiData.total}</p>
              </div>
              <PhoneOff className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold">{kpiData.active}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Escalated</p>
                <p className="text-2xl font-bold">{kpiData.escalated}</p>
              </div>
              <ArrowUpCircle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Closed</p>
                <p className="text-2xl font-bold">{kpiData.closed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Escalation Tabs */}
      <div className="flex gap-2">
        {escalationTabs.map(tab => (
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

      {/* Failure Reasons */}
      <Card>
        <CardHeader>
          <CardTitle>Failure Reasons</CardTitle>
          <CardDescription>Breakdown of all {ndr.length} non-delivery reports by reason</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {reasonBreakdown.map((entry) => (
              <div key={entry.reason}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span>{entry.reason}</span>
                  <span className="text-muted-foreground">
                    {entry.count} ({formatPercent(entry.percent)})
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${entry.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* NDR Table */}
      <Card>
        <CardHeader>
          <CardTitle>Non-Delivery Reports ({filteredNdr.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>NDR ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>AWB</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Last Attempt</TableHead>
                <TableHead>Scheduled Reattempt</TableHead>
                <TableHead>Escalation</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNdr.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.id}</TableCell>
                  <TableCell>{item.orderId}</TableCell>
                  <TableCell className="font-mono">{item.awb}</TableCell>
                  <TableCell>{item.courier}</TableCell>
                  <TableCell>{item.reason}</TableCell>
                  <TableCell>
                    <Badge variant={attemptsBadgeVariant(item.attempts)}>
                      {item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(item.lastAttempt)}</TableCell>
                  <TableCell>
                    {item.scheduledReattempt ? (
                      <div className="flex items-center gap-1">
                        <CalendarClock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm">{formatDate(item.scheduledReattempt)}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.escalationStatus)}>
                      {item.escalationStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.escalationStatus === 'Closed' ? (
                      <Badge variant="outline">Resolved</Badge>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReschedule(item)}
                        >
                          <CalendarClock className="w-4 h-4 mr-1" />
                          Reschedule
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleEscalate(item.id)}
                        >
                          <ArrowUpCircle className="w-4 h-4 mr-1" />
                          Escalate
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* NDR Flow Explainer */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium mb-1">NDR Flow</p>
              <p className="text-sm text-muted-foreground">
                Failed delivery → reason captured from courier → reattempt scheduled → escalation raised once
                attempts are exhausted. Shipments that stay undelivered after escalation move to RTO.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={!!fixItem}
        onOpenChange={(open) => !open && setFixItem(null)}
        title="NDR — customer action"
        description="Fix phone / address, then reattempt. Exhausted attempts go to RTO."
        footer={
          <>
            <Button variant="outline" onClick={() => setFixItem(null)}>Cancel</Button>
            <Button
              onClick={() => {
                toast.success(`${fixItem.id}: ${customerAction}${fixPhone ? ` · ${fixPhone}` : ''}`);
                setFixItem(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">Action</span>
            <select className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={customerAction} onChange={(e) => setCustomerAction(e.target.value)}>
              <option value="reattempt">Reattempt</option>
              <option value="rto">Move to RTO</option>
              <option value="cancel">Cancel shipment</option>
            </select>
          </label>
          <Input placeholder="Corrected phone" value={fixPhone} onChange={(e) => setFixPhone(e.target.value)} />
          <Input placeholder="Corrected address" value={fixAddress} onChange={(e) => setFixAddress(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
