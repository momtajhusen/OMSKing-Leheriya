import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { BadgeCheck, Building2, CalendarDays, Mail, Phone, Printer, Receipt, X } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY } from '../../components/marketing/StickyContactDock';
import api, { apiError } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { LEGAL_LINKS } from '../public/LegalPage';

const COMPANY = {
  active: 'Active',
  trial: 'Trial',
  expired: 'Trial ended',
  suspended: 'Suspended',
};

const MONTH = {
  paid: 'Paid',
  submitted: 'Payment sent',
  trial: 'Included in trial',
  due: 'Due',
};

function openRazorpay(checkout) {
  return new Promise((resolve, reject) => {
    const start = () => {
      const rzp = new window.Razorpay({
        key: checkout.keyId,
        amount: checkout.amount,
        currency: checkout.currency || 'INR',
        name: 'OMSKing',
        description: checkout.description,
        order_id: checkout.orderId,
        method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
        handler: (response) => resolve(response),
        modal: { ondismiss: () => reject(Object.assign(new Error('Payment closed'), { closed: true })) },
      });
      rzp.on('payment.failed', (resp) => reject(new Error(resp?.error?.description || 'Payment failed')));
      rzp.open();
    };
    if (window.Razorpay) {
      start();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = start;
    script.onerror = () => reject(new Error('UPI checkout could not load'));
    document.body.appendChild(script);
  });
}

function money(amount) {
  const value = Number(amount || 0);
  const digits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(value);
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function planName(plan) {
  const name = String(plan || 'starter');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const CHANNEL_MARK = {
  myntra: 'bg-rose-600',
  amazon: 'bg-amber-600',
  shopify: 'bg-lime-700',
  flipkart: 'bg-sky-700',
};

function channelMark(name) {
  return CHANNEL_MARK[String(name || '').toLowerCase()] || 'bg-emerald-700';
}

function BillSheet({ bill }) {
  const status = MONTH[bill.monthStatus] || bill.monthStatus;
  const due = bill.monthStatus !== 'paid';
  return (
    <article className="bill-sheet">
      <header className="bill-sheet-head">
        <div className="bill-brand">
          <BrandLogo className="bill-logo" />
          <div>
            <p className="bill-kicker">OMSKing</p>
            <h1 className="bill-title">Subscription bill</h1>
          </div>
        </div>
        <div className="bill-head-amount">
          <p>{due ? 'Amount due' : 'Paid'}</p>
          <strong>{money(bill.bill)}</strong>
        </div>
      </header>
      <div className="bill-sheet-body">
        <dl className="bill-meta">
          <div>
            <dt><Receipt className="bill-ico" /> Bill number</dt>
            <dd>{bill.billNo}</dd>
          </div>
          <div>
            <dt><CalendarDays className="bill-ico" /> Period</dt>
            <dd>{bill.periodLabel}</dd>
          </div>
          <div>
            <dt><Building2 className="bill-ico" /> Billed to</dt>
            <dd>{bill.name}</dd>
          </div>
          <div>
            <dt><BadgeCheck className="bill-ico" /> Plan</dt>
            <dd>
              {planName(bill.plan)}
              <span className={due ? 'bill-status is-due' : 'bill-status is-paid'}>{status}</span>
            </dd>
          </div>
        </dl>
        <table className="bill-lines">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Billed</th>
              <th>Left out</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(bill.lines || []).map((line) => (
              <tr key={line.channel}>
                <td>
                  <span className={`bill-mark ${channelMark(line.channel)}`}>{String(line.channel || '?').slice(0, 1)}</span>
                  {line.channel}
                </td>
                <td>{line.orders}</td>
                <td>{line.cancelled || 0}</td>
                <td>{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bill-totals">
          <div>
            <span>{Number(bill.orders || 0).toLocaleString('en-IN')} orders × {money(bill.rate)}</span>
            <span>{money(bill.usage)}</span>
          </div>
          <div>
            <span>Minimum monthly</span>
            <span>{money(bill.minimumMonthly)}</span>
          </div>
          <div className="bill-due">
            <span>{due ? 'Amount due' : 'Paid'}</span>
            <strong>{money(bill.bill)}</strong>
          </div>
        </div>
        <p className="bill-note">Cancelled orders are not billed. Pay OMSKing, then enter the UPI reference. Platform confirms it on Plans.</p>
        <footer className="bill-foot">
          <span><Mail className="bill-ico" />{CONTACT_EMAIL}</span>
          <span><Phone className="bill-ico" />{CONTACT_PHONE_DISPLAY}</span>
        </footer>
      </div>
    </article>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export default function SubscriptionPage() {
  const [bill, setBill] = useState(null);
  const [upi, setUpi] = useState(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => Promise.all([
    api.get('/pricing/mine').then(({ data }) => setBill(data.data || null)),
    api.get('/pricing/mine/upi').then(({ data }) => setUpi(data.data || null)).catch(() => setUpi(null)),
  ]);

  useEffect(() => {
    load()
      .catch((err) => toast.error(apiError(err, 'Could not load the subscription')))
      .finally(() => setLoading(false));
  }, []);

  const payAutomatic = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/pricing/mine/checkout');
      const response = await openRazorpay(data.data);
      await api.post('/pricing/mine/confirm', response);
      toast.success('Payment received. This month is paid.');
      await load();
    } catch (err) {
      if (!err?.closed) toast.error(apiError(err, 'Payment could not be completed'));
    } finally {
      setBusy(false);
    }
  };

  const sendReference = async () => {
    setBusy(true);
    try {
      await api.post('/pricing/mine/reference', { reference });
      toast.success('Reference sent. This month shows Paid after OMSKing confirms it.');
      setReference('');
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not send the reference'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading subscription..." />;
  if (!bill) return <EmptyState title="Subscription is not available" description="Open a company account to see its plan and bill." />;

  const payment = bill.payment || {};
  const payRows = [
    payment.upiId && ['UPI', payment.upiId],
    payment.accountName && ['Account name', payment.accountName],
    payment.accountNumber && ['Account number', payment.accountNumber],
    payment.ifsc && ['IFSC', payment.ifsc],
    payment.bankName && ['Bank', payment.bankName],
    payment.note && ['Note', payment.note],
  ].filter(Boolean);
  const monthTone = bill.monthStatus === 'paid' ? 'default' : 'outline';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Subscription</h1>
          <p className="text-sm text-muted-foreground">{bill.name} · {bill.periodLabel}</p>
          <nav className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Legal">
            {LEGAL_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="font-medium text-primary hover:underline">{item.label}</Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{planName(bill.plan)} plan</Badge>
          <Badge variant="outline">{COMPANY[bill.status] || bill.status}</Badge>
          <Badge variant={monthTone}>{MONTH[bill.monthStatus] || bill.monthStatus}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pay with UPI</CardTitle>
          <CardDescription>
            {upi?.ready && upi.razorpayReady && 'Pay opens UPI checkout. This month is marked paid as soon as the payment succeeds.'}
            {upi?.ready && !upi.razorpayReady && 'Scan the QR or open your UPI app. The amount and OMSKing UPI id are already filled in.'}
            {upi && !upi.ready && 'Platform Admin adds the UPI id in Plans. Pay then opens with this month’s amount filled in.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bill.monthStatus === 'paid' && <p className="text-sm">This month is paid.</p>}
          {bill.monthStatus === 'submitted' && (
            <p className="text-sm">Reference {bill.reference} is with OMSKing. This month shows Paid after they confirm it.</p>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {upi?.qr && <img src={upi.qr} alt="UPI QR for this month's bill" className="h-44 w-44 rounded-lg border border-border bg-white p-2" />}
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-2xl font-bold">{money(bill.bill)}</p>
              <p className="text-sm text-muted-foreground">Bill {bill.billNo}{upi?.upiId ? ` · UPI ${upi.upiId}` : ''}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy || bill.monthStatus === 'paid' || !upi?.razorpayReady} onClick={payAutomatic}>
                  {busy ? 'Opening…' : `Pay ${money(bill.bill)}`}
                </Button>
                {upi?.upiUrl && bill.monthStatus !== 'paid' ? (
                  <a href={upi.upiUrl} className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] px-4 text-sm font-medium text-white">
                    Open UPI app
                  </a>
                ) : (
                  <Button type="button" disabled>Open UPI app</Button>
                )}
                <Button type="button" variant="outline" disabled={!upi?.upiId} onClick={() => navigator.clipboard.writeText(upi.upiId).then(() => toast.success('UPI id copied'))}>
                  Copy UPI id
                </Button>
                <Button type="button" variant="outline" onClick={() => setPreview(true)}>
                  Print bill
                </Button>
              </div>
              {bill.monthStatus !== 'paid' && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={reference} placeholder="UPI reference" onChange={(event) => setReference(event.target.value)} />
                  <Button type="button" variant="outline" disabled={busy || !upi?.upiId || reference.trim().length < 6} onClick={sendReference}>
                    I have paid
                  </Button>
                </div>
              )}
              {upi && !upi.ready && bill.monthStatus !== 'paid' && (
                <p className="text-sm text-muted-foreground">Pay, Open UPI app, and I have paid turn on when Platform Admin saves a UPI id in Plans. Print bill is ready now.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-3"><p className="text-sm text-muted-foreground">This month</p><p className="text-2xl font-bold">{money(bill.bill)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-sm text-muted-foreground">Orders counted</p><p className="text-2xl font-bold">{Number(bill.orders || 0).toLocaleString('en-IN')}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-sm text-muted-foreground">Per-order rate</p><p className="text-2xl font-bold">{money(bill.rate)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-sm text-muted-foreground">Minimum monthly</p><p className="text-2xl font-bold">{money(bill.minimumMonthly)}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>This month’s bill</CardTitle>
            <CardDescription>{bill.message}</CardDescription>
          </CardHeader>
          <CardContent>
            {(bill.lines || []).map((line) => (
              <Row key={line.channel} label={line.channel} value={`${line.orders.toLocaleString('en-IN')} orders · ${money(line.amount)}${line.cancelled ? ` · ${line.cancelled} cancelled left out` : ''}`} />
            ))}
            {bill.cancelled > 0 && <Row label="Cancelled, not billed" value={String(bill.cancelled)} />}
            <Row label="Orders × rate" value={`${Number(bill.orders || 0).toLocaleString('en-IN')} × ${money(bill.rate)} = ${money(bill.usage)}`} />
            <Row label="Minimum monthly charge" value={money(bill.minimumMonthly)} />
            <Row label="Raised to the minimum" value={bill.adjustment > 0 ? money(bill.adjustment) : 'Usage already covers it'} />
            <Row label="Amount" value={money(bill.bill)} />
            {bill.paidAt && <Row label="Recorded paid" value={`${money(bill.bill)} on ${when(bill.paidAt)}`} />}
            {bill.nextSlab && (
              <p className="pt-3 text-sm text-muted-foreground">
                From {(bill.nextSlab.startsAfter + 1).toLocaleString('en-IN')} orders the rate becomes {money(bill.nextSlab.rate)} ({bill.nextSlab.label}).
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
            <CardDescription>The company subscription OMSKing is billing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="Company" value={bill.name} />
            <Row label="Plan" value={planName(bill.plan)} />
            <Row label="Standing" value={COMPANY[bill.status] || bill.status} />
            <Row label="Started" value={when(bill.startedAt)} />
            <Row label={bill.status === 'trial' ? 'Trial ends' : 'Plan through'} value={when(bill.planExpiresAt)} />
            <Row label="Days left" value={bill.planExpiresAt ? String(bill.daysLeft ?? 0) : 'No end date'} />
            <Row label="Billing month" value={bill.periodLabel} />
            <Row label="Current slab" value={bill.currentSlab || '—'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rate card</CardTitle>
          <CardDescription>Cancelled orders are left out. The bill is the higher of the minimum and orders × the slab rate.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orders</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>This month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(bill.slabs || []).map((slab) => (
                <TableRow key={slab.label}>
                  <TableCell>{slab.label}</TableCell>
                  <TableCell>{money(slab.rate)} / order</TableCell>
                  <TableCell>{slab.label === bill.currentSlab ? <Badge>Your slab</Badge> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How to pay</CardTitle>
            <CardDescription>Pay OMSKing with these details, then the platform marks the month received.</CardDescription>
          </CardHeader>
          <CardContent>
            {payRows.length ? payRows.map(([label, value]) => <Row key={label} label={label} value={value} />) : (
              <p className="text-sm text-muted-foreground">OMSKing has not added payment details yet. Contact the platform admin.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments recorded</CardTitle>
            <CardDescription>Each row is one calendar month marked paid by OMSKing.</CardDescription>
          </CardHeader>
          <CardContent>
            {bill.history?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bill.history.map((row) => (
                    <TableRow key={row.period}>
                      <TableCell>
                        <div>{row.periodLabel}</div>
                        {row.note && <div className="text-xs text-muted-foreground">{row.note}</div>}
                      </TableCell>
                      <TableCell>{Number(row.orders || 0).toLocaleString('en-IN')}</TableCell>
                      <TableCell>{money(row.amount)}</TableCell>
                      <TableCell>{row.status === 'submitted' ? 'Waiting' : when(row.paidAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No payment has been recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
      {preview && createPortal(
        <div className="bill-overlay">
          <div className="bill-frame">
            <div className="bill-scroll">
              <BillSheet bill={bill} />
            </div>
            <div className="bill-actions">
              <Button type="button" variant="outline" onClick={() => setPreview(false)}>
                <X className="mr-2 h-4 w-4" />
                Close
              </Button>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
