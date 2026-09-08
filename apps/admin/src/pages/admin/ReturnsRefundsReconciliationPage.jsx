import { useState } from 'react';
import { reconciliations } from '../../mocks';
import { formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Upload, RotateCcw, PackageCheck, Clock, AlertTriangle, Store, Info } from 'lucide-react';

const reconStatusMeta = {
  matched: { label: 'Matched', variant: 'outline' },
  unmatched: { label: 'Unmatched', variant: 'destructive' },
  mismatch: { label: 'Mismatch', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
};

const tabs = [
  { id: 'all', label: 'All' },
  { id: 'return_received', label: 'Return Received' },
  { id: 'refund_pending', label: 'Refund Pending' },
  { id: 'mismatch', label: 'Mismatch' },
];

const channels = ['Shopify', 'Amazon', 'Myntra'];

export default function ReturnsRefundsReconciliationPage() {
  const [activeTab, setActiveTab] = useState('all');

  const returnReceivedCount = reconciliations.filter(
    (r) => r.returnStatus === 'Return Received'
  ).length;
  const refundPendingCount = reconciliations.filter(
    (r) => r.returnStatus === 'Refund Pending'
  ).length;
  const mismatchCount = reconciliations.filter((r) => r.status === 'mismatch').length;
  const withReturnActivity = reconciliations.filter((r) => r.returnStatus !== 'None').length;

  const filteredRecords = reconciliations.filter((r) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'return_received') return r.returnStatus === 'Return Received';
    if (activeTab === 'refund_pending') return r.returnStatus === 'Refund Pending';
    return r.status === 'mismatch';
  });

  const channelSummary = channels.map((channel) => {
    const rows = reconciliations.filter((r) => r.marketplace === channel);
    return {
      channel,
      total: rows.length,
      unmatched: rows.filter((r) => r.status !== 'matched').length,
    };
  });

  const handleUploadReturnFile = () => {
    console.log('Uploading return file');
  };

  const handleViewOrder = (orderId) => {
    console.log('Viewing order:', orderId);
  };

  const renderStatusBadge = (status) => {
    const meta = reconStatusMeta[status] || { label: status, variant: 'default' };
    return <Badge variant={meta.variant}>{meta.label}</Badge>;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Returns / Refunds Reconciliation</h1>
          <p className="text-muted-foreground">
            Refunds and return adjustments against the same Master Order. Restock destination is set at QC.
          </p>
        </div>
        <Button onClick={handleUploadReturnFile}>
          <Upload className="w-4 h-4 mr-2" />
          Upload Return File
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Return Records</p>
                <p className="text-2xl font-bold">{reconciliations.length}</p>
                <p className="text-xs text-muted-foreground">
                  {withReturnActivity} with return activity
                </p>
              </div>
              <RotateCcw className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Return Received</p>
                <p className="text-2xl font-bold">{returnReceivedCount}</p>
                <p className="text-xs text-muted-foreground">Matched in return file</p>
              </div>
              <PackageCheck className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Refund Pending</p>
                <p className="text-2xl font-bold">{refundPendingCount}</p>
                <p className="text-xs text-muted-foreground">Adjustment not settled</p>
              </div>
              <Clock className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Mismatches</p>
                <p className="text-2xl font-bold">{mismatchCount}</p>
                <p className="text-xs text-muted-foreground">Need manual review</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-channel summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {channelSummary.map((summary) => (
          <Card key={summary.channel}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{summary.channel}</p>
                  <p className="text-2xl font-bold">{summary.total} records</p>
                  <p className="text-xs text-muted-foreground">
                    {summary.unmatched} still unmatched
                  </p>
                </div>
                <Store className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Reconciliation Records */}
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Records ({filteredRecords.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reconciliation ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Order Status</TableHead>
                <TableHead>Return Status</TableHead>
                <TableHead>Refund / Payment</TableHead>
                <TableHead>Ref No</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.id}</TableCell>
                  <TableCell>{record.orderId}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{record.marketplace}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(record.uploadDate)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(record.orderStatus)}>
                      {record.orderStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {record.returnStatus === 'None' ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Badge
                        variant={
                          record.returnStatus === 'Return Received' ? 'outline' : 'secondary'
                        }
                      >
                        {record.returnStatus}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(record.paymentStatus)}>
                      {record.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{record.refNo}</TableCell>
                  <TableCell>{renderStatusBadge(record.status)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewOrder(record.orderId)}
                    >
                      View Order
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Rules Explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="w-5 h-5" />
            How return reconciliation works
          </CardTitle>
          <CardDescription>Three steps, no manual cross-checking</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">1. Upload:</span> drop the Amazon
            or Myntra return file straight into the OMS, the same way payment files are
            uploaded.
          </p>
          <p>
            <span className="font-medium text-foreground">2. Match:</span> every order the
            system finds in the file is marked &ldquo;Return Received&rdquo; and its refund
            is checked against the expected value.
          </p>
          <p>
            <span className="font-medium text-foreground">3. Review:</span> rows that could
            not be matched, or where the refund does not equal the expected value, stay
            flagged as Unmatched or Mismatch for manual review.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
