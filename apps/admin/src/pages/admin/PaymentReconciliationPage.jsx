import { useState } from 'react';
import dayjs from 'dayjs';
import { payments, reconciliations } from '../../mocks';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import Input from '../../components/ui/Input';
import { Upload, IndianRupee, CheckCircle2, AlertTriangle, Clock, Info } from 'lucide-react';

// Orders older than this are treated as "payment / RTO not received yet"
const AGEING_THRESHOLD_DAYS = 30;

const settlementStatusMeta = {
  matched: { label: 'Matched', variant: 'outline' },
  short_paid: { label: 'Short Paid', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
  overpaid: { label: 'Overpaid', variant: 'default' },
  mismatch: { label: 'Mismatch', variant: 'destructive' },
};

const tabs = [
  { id: 'all', label: 'All' },
  { id: 'matched', label: 'Matched' },
  { id: 'short_paid', label: 'Short Paid' },
  { id: 'pending', label: 'Pending' },
  { id: 'mismatch', label: 'Mismatch' },
];

export default function PaymentReconciliationPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [channel, setChannel] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [orderIdQuery, setOrderIdQuery] = useState('');

  const matchedCount = payments.filter((p) => p.status === 'matched').length;
  const shortPaidCount = payments.filter((p) => p.status === 'short_paid').length;
  const pendingCount = payments.filter((p) => p.status === 'pending').length;
  const totalSettled = payments.reduce((sum, p) => sum + p.amount, 0);

  const isMismatch = (status) => status === 'mismatch' || status === 'overpaid';

  const filteredPayments = payments.filter((p) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'mismatch') return isMismatch(p.status);
    return p.status === activeTab;
  });

  // Shopify rule: Paid and Cancelled orders never reach here. Fulfilled + Unpaid
  // means the payment (or the RTO) has not landed yet.
  const shopifyPending = reconciliations
    .filter(
      (r) =>
        r.marketplace === 'Shopify' &&
        r.orderStatus === 'Fulfilled' &&
        r.paymentStatus === 'Unpaid'
    )
    .map((r) => ({ ...r, ageing: dayjs().diff(dayjs(r.uploadDate), 'day') }))
    .sort((a, b) => b.ageing - a.ageing);

  const flaggedShopifyCount = shopifyPending.filter(
    (r) => r.ageing > AGEING_THRESHOLD_DAYS
  ).length;

  const handleUpload = (marketplace) => {
    console.log('Uploading payment file for:', marketplace);
  };

  const handleViewOrder = (orderId) => {
    console.log('Viewing order:', orderId);
  };

  const renderStatusBadge = (status) => {
    const meta = settlementStatusMeta[status] || { label: status, variant: 'default' };
    return <Badge variant={meta.variant}>{meta.label}</Badge>;
  };

  const renderDifference = (payment) => {
    if (payment.status === 'pending') {
      return <span className="text-muted-foreground">&mdash;</span>;
    }
    const difference = payment.amount - payment.expectedAmount;
    if (difference === 0) {
      return <span className="text-muted-foreground">{formatINR(0)}</span>;
    }
    return (
      <span className={difference > 0 ? 'text-green-600' : 'text-destructive'}>
        {difference > 0 ? '+' : ''}
        {formatINR(difference)}
      </span>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Payment Reconciliation</h1>
          <p className="text-muted-foreground">
            Marketplace settlement vs expected net, plus courier invoice mismatches (weight, COD, RTO) as a separate recon.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleUpload('Amazon')}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Amazon Payment File
          </Button>
          <Button onClick={() => handleUpload('Myntra')}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Myntra Payment File
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Courier invoice recon</CardTitle>
          <CardDescription>
            Separate from marketplace settlement. Weight, COD remittance, RTO, NDR and surcharge vs billed AWB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>AWB</TableHead>
                <TableHead>Billed</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Issue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">CINV-1042</TableCell>
                <TableCell>Delhivery</TableCell>
                <TableCell>DEL123456789</TableCell>
                <TableCell>{formatINR(186)}</TableCell>
                <TableCell>{formatINR(142)}</TableCell>
                <TableCell><Badge variant="destructive">Weight mismatch</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">CINV-1043</TableCell>
                <TableCell>Bluedart</TableCell>
                <TableCell>BLU987654321</TableCell>
                <TableCell>{formatINR(0)}</TableCell>
                <TableCell>{formatINR(2490)}</TableCell>
                <TableCell><Badge variant="secondary">COD not remitted</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation</CardTitle>
          <CardDescription>
            Filter by channel, order ID and status. Payment Received and Return Received are Yes / No.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="w-44">
              <label className="block text-xs text-muted-foreground mb-1">Channel</label>
              <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all">All</option>
                <option value="Shopify">Shopify</option>
                <option value="Amazon">Amazon</option>
                <option value="Myntra">Myntra</option>
              </Select>
            </div>
            <div className="w-48">
              <label className="block text-xs text-muted-foreground mb-1">Order ID</label>
              <Input
                value={orderIdQuery}
                onChange={(e) => setOrderIdQuery(e.target.value)}
                placeholder="e.g. 65210-LEH"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs text-muted-foreground mb-1">Status</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="delivered">Delivered</option>
                <option value="returned">Returned</option>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment Recd.</TableHead>
                <TableHead>Return Recd.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliations
                .filter((r) => channel === 'all' || r.marketplace === channel)
                .filter((r) => !orderIdQuery || r.orderId.toLowerCase().includes(orderIdQuery.toLowerCase()))
                .filter((r) => {
                  if (statusFilter === 'all') return true;
                  if (statusFilter === 'delivered') return r.orderStatus === 'Delivered';
                  if (statusFilter === 'returned') return r.returnStatus !== 'None';
                  return r.orderStatus !== 'Delivered' && r.returnStatus === 'None';
                })
                .map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="outline">{row.marketplace}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.orderId}</TableCell>
                    <TableCell>{row.returnStatus !== 'None' ? 'Returned' : row.orderStatus}</TableCell>
                    <TableCell>
                      <Badge variant={row.paymentStatus === 'Received' ? 'outline' : 'secondary'}>
                        {row.paymentStatus === 'Received' ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.returnStatus === 'Return Received' ? 'outline' : 'secondary'}>
                        {row.returnStatus === 'Return Received' ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Settlements</p>
                <p className="text-2xl font-bold">{payments.length}</p>
                <p className="text-xs text-muted-foreground">
                  {formatINR(totalSettled)} settled
                </p>
              </div>
              <IndianRupee className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Matched</p>
                <p className="text-2xl font-bold">{matchedCount}</p>
                <p className="text-xs text-muted-foreground">Amount equals expected</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Short Paid</p>
                <p className="text-2xl font-bold">{shortPaidCount}</p>
                <p className="text-xs text-muted-foreground">Received less than expected</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Settlement not received</p>
              </div>
              <Clock className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shopify Section */}
      <Card>
        <CardHeader>
          <CardTitle>Shopify &mdash; Payment Not Received ({shopifyPending.length})</CardTitle>
          <CardDescription>
            Paid and Cancelled orders are excluded automatically. An order that is
            Fulfilled but still Unpaid past {AGEING_THRESHOLD_DAYS} days means the payment
            (or the RTO) has not come through yet &mdash; {flaggedShopifyCount} of these
            need review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Order Status</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Ageing (days)</TableHead>
                <TableHead>Ref No</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopifyPending.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.orderId}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(row.orderStatus)}>
                      {row.orderStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(row.paymentStatus)}>
                      {row.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(row.uploadDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={row.ageing > AGEING_THRESHOLD_DAYS ? 'destructive' : 'secondary'}
                    >
                      {row.ageing} days
                    </Badge>
                  </TableCell>
                  <TableCell>{row.refNo}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => handleViewOrder(row.orderId)}>
                      View Order
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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

      {/* Amazon / Myntra Settlements */}
      <Card>
        <CardHeader>
          <CardTitle>Amazon / Myntra Settlements ({filteredPayments.length})</CardTitle>
          <CardDescription>
            Settlement lines from the uploaded Amazon and Myntra payment files, matched
            against the expected order value.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payment ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead>Settlement Date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Difference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="font-medium">{payment.paymentId}</TableCell>
                  <TableCell>{payment.orderId}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{payment.marketplace}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(payment.settlementDate)}</TableCell>
                  <TableCell>{formatINR(payment.expectedAmount)}</TableCell>
                  <TableCell>
                    {payment.status === 'pending' ? (
                      <span className="text-muted-foreground">Awaited</span>
                    ) : (
                      formatINR(payment.amount)
                    )}
                  </TableCell>
                  <TableCell>{renderDifference(payment)}</TableCell>
                  <TableCell>{renderStatusBadge(payment.status)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewOrder(payment.orderId)}
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
            How reconciliation works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Shopify:</span> orders that are
            already Paid and orders that were Cancelled are excluded automatically. Only
            orders that are Fulfilled but still Unpaid are listed &mdash; once they cross{' '}
            {AGEING_THRESHOLD_DAYS} days it means the payment or the RTO has not been
            received yet, so they are flagged for review.
          </p>
          <p>
            <span className="font-medium text-foreground">Amazon / Myntra:</span> upload
            the marketplace payment file and the system matches each settlement line to an
            order. Matched orders are marked &ldquo;Payment Received&rdquo;; anything paid
            below the expected value is Short Paid, and settlements above the expected
            value are grouped under Mismatch.
          </p>
          <p>
            The system identifies which orders&rsquo; payment has not come through, so no
            manual cross-checking of settlement files is needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
