import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Mail,
  Package,
  Phone,
  Printer,
  Receipt,
  Shield,
  Wallet,
  X,
} from 'lucide-react';
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
            <p className="bill-subtitle">{bill.periodLabel}</p>
          </div>
        </div>
        <div className="bill-head-amount">
          <p>{due ? 'Amount due' : 'Paid'}</p>
          <strong>{money(bill.bill)}</strong>
          <span className={due ? 'bill-status is-due' : 'bill-status is-paid'}>{status}</span>
        </div>
      </header>
      <div className="bill-sheet-body">
        <dl className="bill-meta">
          <div className="bill-meta-card">
            <dt><Receipt className="bill-ico" /> Bill number</dt>
            <dd>{bill.billNo}</dd>
          </div>
          <div className="bill-meta-card">
            <dt><CalendarDays className="bill-ico" /> Period</dt>
            <dd>{bill.periodLabel}</dd>
          </div>
          <div className="bill-meta-card">
            <dt><Building2 className="bill-ico" /> Billed to</dt>
            <dd>{bill.name}</dd>
          </div>
          <div className="bill-meta-card">
            <dt><BadgeCheck className="bill-ico" /> Plan</dt>
            <dd>{planName(bill.plan)}</dd>
          </div>
        </dl>

        <div className="bill-section">
          <div className="bill-section-head">
            <h2>Channel breakdown</h2>
            <p>Cancelled orders are left out of the bill</p>
          </div>
          <table className="bill-lines">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Orders billed</th>
                <th>Cancelled</th>
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
                  <td>{Number(line.orders || 0).toLocaleString('en-IN')}</td>
                  <td>{Number(line.cancelled || 0).toLocaleString('en-IN')}</td>
                  <td>{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bill-summary">
          <div className="bill-summary-copy">
            <h2>How this bill is calculated</h2>
            <p>
              {Number(bill.orders || 0).toLocaleString('en-IN')} billed orders × {money(bill.rate)} per order.
              The charge is never below the monthly minimum of {money(bill.minimumMonthly)}.
            </p>
          </div>
          <div className="bill-totals">
            <div>
              <span>{Number(bill.orders || 0).toLocaleString('en-IN')} orders × {money(bill.rate)}</span>
              <span>{money(bill.usage)}</span>
            </div>
            <div>
              <span>Minimum monthly</span>
              <span>{money(bill.minimumMonthly)}</span>
            </div>
            {bill.adjustment > 0 && (
              <div>
                <span>Raised to minimum</span>
                <span>{money(bill.adjustment)}</span>
              </div>
            )}
            <div className="bill-due">
              <span>{due ? 'Amount due' : 'Paid'}</span>
              <strong>{money(bill.bill)}</strong>
            </div>
          </div>
        </div>

        <p className="bill-note">
          Pay OMSKing with UPI, then enter the UPI reference on Subscription. Platform confirms it on Plans.
        </p>
        <footer className="bill-foot">
          <span><Mail className="bill-ico" />{CONTACT_EMAIL}</span>
          <span><Phone className="bill-ico" />{CONTACT_PHONE_DISPLAY}</span>
        </footer>
      </div>
    </article>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right text-sm font-medium leading-snug">{value}</span>
    </div>
  );
}

function StepBadge({ n, done, active }) {
  return (
    <span
      className={[
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
        done ? 'bg-emerald-600 text-white' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      ].join(' ')}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
    </span>
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

  const isPaid = bill.monthStatus === 'paid';
  const isSubmitted = bill.monthStatus === 'submitted';
  const isDue = !isPaid && !isSubmitted && bill.monthStatus !== 'trial';
  const monthLabel = MONTH[bill.monthStatus] || bill.monthStatus;
  const payHint = upi?.ready && upi.razorpayReady
    ? 'Pay opens UPI checkout. This month is marked paid as soon as the payment succeeds.'
    : upi?.ready && !upi.razorpayReady
      ? 'Scan the QR or open your UPI app. The amount and OMSKing UPI id are already filled in.'
      : 'Platform Admin adds the UPI id in Plans. Pay then opens with this month’s amount filled in.';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{bill.name}</span>
            <span className="mx-1.5 text-border">·</span>
            {bill.periodLabel}
          </p>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground" aria-label="Legal">
            {LEGAL_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="hover:text-primary hover:underline">{item.label}</Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Shield className="h-3 w-3" />
            {planName(bill.plan)} plan
          </Badge>
          <Badge variant="outline">{COMPANY[bill.status] || bill.status}</Badge>
          <Badge
            variant={isPaid ? 'default' : 'outline'}
            className={isDue ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : isSubmitted ? 'border-sky-500/60 text-sky-700 dark:text-sky-400' : ''}
          >
            {monthLabel}
          </Badge>
        </div>
      </div>

      {/* Pay hero — one clear amount + steps */}
      <Card className="overflow-hidden border-primary/20 shadow-sm">
        <div className="grid lg:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {isPaid ? 'Paid this month' : isSubmitted ? 'Waiting for confirmation' : 'Amount due'}
                </p>
                <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{money(bill.bill)}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Bill <span className="font-medium text-foreground">{bill.billNo}</span>
                  {upi?.upiId ? <> · UPI <span className="font-medium text-foreground">{upi.upiId}</span></> : null}
                </p>
              </div>
              <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                isPaid
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : isSubmitted
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
              }`}
              >
                {isPaid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                {monthLabel}
              </div>
            </div>

            {isPaid && (
              <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-800 dark:text-emerald-300">
                This month is paid{bill.paidAt ? ` · recorded ${when(bill.paidAt)}` : ''}.
              </p>
            )}
            {isSubmitted && (
              <p className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3.5 py-2.5 text-sm text-sky-900 dark:text-sky-300">
                Reference <span className="font-semibold">{bill.reference}</span> is with OMSKing. Paid after they confirm it.
              </p>
            )}
            {!isPaid && !isSubmitted && (
              <p className="text-sm text-muted-foreground">{payHint}</p>
            )}

            {!isPaid && (
              <ol className="space-y-4">
                <li className="rounded-2xl border border-border/80 bg-muted/30 p-3.5 sm:p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <StepBadge n={1} active={!isSubmitted} done={isSubmitted || isPaid} />
                    <div>
                      <p className="text-sm font-semibold">Pay OMSKing</p>
                      <p className="text-xs text-muted-foreground">Use Pay, Open UPI app, or scan the QR</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={busy || isPaid || !upi?.razorpayReady} onClick={payAutomatic}>
                      <Wallet className="mr-1.5 h-4 w-4" />
                      {busy ? 'Opening…' : `Pay ${money(bill.bill)}`}
                    </Button>
                    {upi?.upiUrl && !isPaid ? (
                      <a
                        href={upi.upiUrl}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/15"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open UPI app
                      </a>
                    ) : (
                      <Button type="button" variant="outline" disabled>
                        <ExternalLink className="mr-1.5 h-4 w-4" />
                        Open UPI app
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!upi?.upiId}
                      onClick={() => navigator.clipboard.writeText(upi.upiId).then(() => toast.success('UPI id copied'))}
                    >
                      <Copy className="mr-1.5 h-4 w-4" />
                      Copy UPI id
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setPreview(true)}>
                      <Printer className="mr-1.5 h-4 w-4" />
                      Print bill
                    </Button>
                  </div>
                  {upi && !upi.ready && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Pay, Open UPI app, and I have paid turn on when Platform Admin saves a UPI id in Plans. Print bill is ready now.
                    </p>
                  )}
                </li>

                <li className="rounded-2xl border border-border/80 bg-muted/30 p-3.5 sm:p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <StepBadge n={2} active={!isSubmitted} done={isSubmitted || isPaid} />
                    <div>
                      <p className="text-sm font-semibold">Tell us you paid</p>
                      <p className="text-xs text-muted-foreground">Paste the UPI reference from your bank app</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={reference}
                      placeholder="UPI reference"
                      onChange={(event) => setReference(event.target.value)}
                      className="sm:max-w-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !upi?.upiId || reference.trim().length < 6}
                      onClick={sendReference}
                    >
                      I have paid
                    </Button>
                  </div>
                </li>

                <li className="flex items-start gap-2 px-1">
                  <StepBadge n={3} done={isPaid} active={isSubmitted} />
                  <div>
                    <p className="text-sm font-semibold">OMSKing confirms</p>
                    <p className="text-xs text-muted-foreground">Month shows Paid after platform confirmation</p>
                  </div>
                </li>
              </ol>
            )}

            {isPaid && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setPreview(true)}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  Print bill
                </Button>
              </div>
            )}
          </div>

          <aside className="flex flex-col justify-between gap-4 border-t border-border/70 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-lime-500/[0.06] p-5 sm:p-6 lg:border-l lg:border-t-0">
            {upi?.qr ? (
              <div className="mx-auto text-center">
                <img
                  src={upi.qr}
                  alt="UPI QR for this month's bill"
                  className="mx-auto h-44 w-44 rounded-2xl border border-border bg-white p-2 shadow-sm"
                />
                <p className="mt-2 text-xs text-muted-foreground">Scan to pay this month’s bill</p>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/40 px-4 py-8 text-center">
                <Wallet className="mb-2 h-8 w-8 text-muted-foreground/70" />
                <p className="text-sm font-medium">UPI QR appears here</p>
                <p className="mt-1 max-w-[14rem] text-xs text-muted-foreground">
                  When Platform Admin saves a UPI id, the QR for this amount shows up.
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2.5 text-center">
                <Package className="mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Orders</p>
                <p className="text-sm font-bold tabular-nums">{Number(bill.orders || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2.5 text-center">
                <Receipt className="mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Rate</p>
                <p className="text-sm font-bold tabular-nums">{money(bill.rate)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 px-2.5 py-2.5 text-center">
                <Shield className="mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Minimum</p>
                <p className="text-sm font-bold tabular-nums">{money(bill.minimumMonthly)}</p>
              </div>
            </div>
          </aside>
        </div>
      </Card>

      {/* Bill + plan */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">This month’s bill</CardTitle>
            <CardDescription>
              {bill.message || 'Orders × rate, never below the monthly minimum. Cancelled orders are left out.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="overflow-hidden rounded-xl border border-border/70">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Channel</span>
                <span className="text-right">Orders</span>
                <span className="min-w-[5.5rem] text-right">Amount</span>
              </div>
              {(bill.lines || []).map((line) => (
                <div
                  key={line.channel}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-border/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${channelMark(line.channel)}`}>
                        {String(line.channel || '?').slice(0, 1)}
                      </span>
                      <span className="truncate text-sm font-medium">{line.channel}</span>
                    </div>
                    {line.cancelled > 0 && (
                      <p className="mt-0.5 pl-7 text-xs text-muted-foreground">{line.cancelled} cancelled left out</p>
                    )}
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">{line.orders.toLocaleString('en-IN')}</span>
                  <span className="min-w-[5.5rem] text-right text-sm font-semibold tabular-nums">{money(line.amount)}</span>
                </div>
              ))}
              {bill.cancelled > 0 && (
                <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-border/60 bg-muted/20 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Cancelled, not billed</span>
                  <span className="font-medium tabular-nums">{bill.cancelled}</span>
                </div>
              )}
            </div>

            <div className="pt-2">
              <MetaRow label="Orders × rate" value={`${Number(bill.orders || 0).toLocaleString('en-IN')} × ${money(bill.rate)} = ${money(bill.usage)}`} />
              <MetaRow label="Minimum monthly" value={money(bill.minimumMonthly)} />
              <MetaRow label="Raised to minimum" value={bill.adjustment > 0 ? money(bill.adjustment) : 'Usage already covers it'} />
              <MetaRow label="Amount due" value={<span className="text-base font-bold">{money(bill.bill)}</span>} />
            </div>

            {bill.nextSlab && (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                From {(bill.nextSlab.startsAfter + 1).toLocaleString('en-IN')} orders the rate becomes {money(bill.nextSlab.rate)} ({bill.nextSlab.label}).
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Plan</CardTitle>
            <CardDescription>Company subscription OMSKing is billing</CardDescription>
          </CardHeader>
          <CardContent>
            <MetaRow label="Company" value={bill.name} />
            <MetaRow label="Plan" value={planName(bill.plan)} />
            <MetaRow label="Standing" value={COMPANY[bill.status] || bill.status} />
            <MetaRow label="Started" value={when(bill.startedAt)} />
            <MetaRow label={bill.status === 'trial' ? 'Trial ends' : 'Plan through'} value={when(bill.planExpiresAt)} />
            <MetaRow label="Days left" value={bill.planExpiresAt ? String(bill.daysLeft ?? 0) : 'No end date'} />
            <MetaRow label="Billing month" value={bill.periodLabel} />
            <MetaRow label="Current slab" value={bill.currentSlab || '—'} />
          </CardContent>
        </Card>
      </div>

      {/* Rate card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rate card</CardTitle>
          <CardDescription>Cancelled orders are left out. Bill is the higher of minimum and orders × slab rate.</CardDescription>
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

      {/* Pay details + history */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How to pay</CardTitle>
            <CardDescription>Bank / UPI details saved by Platform Admin</CardDescription>
          </CardHeader>
          <CardContent>
            {payRows.length ? payRows.map(([label, value]) => <MetaRow key={label} label={label} value={value} />) : (
              <p className="rounded-xl border border-dashed border-border px-3.5 py-4 text-sm text-muted-foreground">
                OMSKing has not added payment details yet. Contact the platform admin.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payments recorded</CardTitle>
            <CardDescription>Each row is one calendar month marked paid</CardDescription>
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
              <p className="rounded-xl border border-dashed border-border px-3.5 py-4 text-sm text-muted-foreground">
                No payment has been recorded yet.
              </p>
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
