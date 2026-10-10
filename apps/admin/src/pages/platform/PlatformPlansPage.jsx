import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';

const emptySlab = () => ({ upTo: '', rate: '' });

function webhookUrl() {
  const base = String(api.defaults.baseURL || '');
  const root = base.startsWith('http') ? base.replace(/\/$/, '') : 'https://omskingapi.codersalpha.com/api/v1';
  return `${root}/pricing/razorpay-webhook`;
}

export default function PlatformPlansPage() {
  const [minimumMonthly, setMinimumMonthly] = useState('');
  const [slabs, setSlabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inquiries, setInquiries] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [marking, setMarking] = useState('');
  const [payment, setPayment] = useState({
    upiId: '', accountName: '', accountNumber: '', ifsc: '', bankName: '', note: '',
    razorpayKeyId: '', razorpayKeySecret: '', razorpayWebhookSecret: '',
  });
  const [gateway, setGateway] = useState({ razorpayReady: false, webhookReady: false });

  useEffect(() => {
    api.get('/pricing/inquiries')
      .then(({ data }) => setInquiries(data.data || []))
      .catch(() => setInquiries([]));
    api.get('/pricing/subscriptions')
      .then(({ data }) => {
        const card = data.data || {};
        setSubscriptions(card.rows || []);
        if (card.payment) {
          setPayment({
            upiId: card.payment.upiId || '',
            accountName: card.payment.accountName || '',
            accountNumber: card.payment.accountNumber || '',
            ifsc: card.payment.ifsc || '',
            bankName: card.payment.bankName || '',
            note: card.payment.note || '',
            razorpayKeyId: card.payment.razorpayKeyId || '',
            razorpayKeySecret: '',
            razorpayWebhookSecret: '',
          });
          setGateway({ razorpayReady: Boolean(card.payment.razorpayReady), webhookReady: Boolean(card.payment.webhookReady) });
        }
      })
      .catch((err) => toast.error(apiError(err, 'Could not load subscriptions')));
    api.get('/pricing')
      .then(({ data }) => {
        const card = data.data || {};
        setMinimumMonthly(String(card.minimumMonthly ?? ''));
        setSlabs((card.slabs || []).map((slab) => ({
          upTo: slab.upTo == null ? '' : String(slab.upTo),
          rate: String(slab.rate),
        })));
      })
      .catch((err) => toast.error(apiError(err, 'Could not load pricing')))
      .finally(() => setLoading(false));
  }, []);

  const updateSlab = (index, key, value) => {
    setSlabs((current) => current.map((slab, i) => (i === index ? { ...slab, [key]: value } : slab)));
  };

  const addSlab = () => {
    setSlabs((current) => {
      const next = [...current];
      next.splice(Math.max(next.length - 1, 0), 0, emptySlab());
      return next;
    });
  };

  const removeSlab = (index) => {
    setSlabs((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/pricing', {
        minimumMonthly: Number(minimumMonthly),
        slabs: slabs.map((slab, index) => ({
          upTo: index === slabs.length - 1 ? null : Number(slab.upTo),
          rate: Number(slab.rate),
        })),
        payment,
      });
      if (data.data?.payment) {
        setPayment({
          upiId: data.data.payment.upiId || '',
          accountName: data.data.payment.accountName || '',
          accountNumber: data.data.payment.accountNumber || '',
          ifsc: data.data.payment.ifsc || '',
          bankName: data.data.payment.bankName || '',
          note: data.data.payment.note || '',
          razorpayKeyId: data.data.payment.razorpayKeyId || '',
          razorpayKeySecret: '',
          razorpayWebhookSecret: '',
        });
        setGateway({ razorpayReady: Boolean(data.data.payment.razorpayReady), webhookReady: Boolean(data.data.payment.webhookReady) });
      }
      const card = data.data || {};
      setMinimumMonthly(String(card.minimumMonthly ?? ''));
      setSlabs((card.slabs || []).map((slab) => ({
        upTo: slab.upTo == null ? '' : String(slab.upTo),
        rate: String(slab.rate),
      })));
      const fresh = await api.get('/pricing/subscriptions');
      setSubscriptions(fresh.data.data?.rows || []);
      toast.success('Pricing and payment details saved');
    } catch (err) {
      toast.error(apiError(err, 'Could not save pricing'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading pricing…" />;

  return (
    <PlatformPage
      title="Subscriptions"
      subtitle="Rate card, UPI checkout, and which month is paid."
      action={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save pricing'}</Button>}
    >
      <div className="premium-card max-w-3xl space-y-5 p-6">
        <div className="max-w-xs">
          <label htmlFor="minimum" className="mb-1.5 block text-sm font-medium">Minimum per month (₹)</label>
          <Input id="minimum" inputMode="decimal" value={minimumMonthly} onChange={(event) => setMinimumMonthly(event.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Order slabs</p>
            <Button type="button" variant="outline" onClick={addSlab}>Add slab</Button>
          </div>
          {slabs.map((slab, index) => {
            const last = index === slabs.length - 1;
            return (
              <div key={index} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{last ? 'Orders' : 'Up to orders'}</label>
                  <Input
                    value={last ? 'And above' : slab.upTo}
                    disabled={last}
                    inputMode="numeric"
                    onChange={(event) => updateSlab(index, 'upTo', event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">₹ per order</label>
                  <Input inputMode="decimal" value={slab.rate} onChange={(event) => updateSlab(index, 'rate', event.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" disabled={slabs.length <= 1 || last} onClick={() => removeSlab(index)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="premium-card max-w-3xl space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Payment details</h2>
          <p className="text-sm text-muted-foreground">The UPI id opens PhonePe, Google Pay, and Paytm with the bill filled in. Razorpay marks the month paid as soon as that payment succeeds. Companies read the same rules on <Link to="/billing" className="font-medium text-primary hover:underline">Billing</Link>.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['upiId', 'UPI id', 'omsking@bank'],
            ['accountName', 'Account name', 'OMSKing'],
            ['accountNumber', 'Account number', ''],
            ['ifsc', 'IFSC', ''],
            ['bankName', 'Bank', ''],
          ].map(([key, label, placeholder]) => (
            <div key={key}>
              <label className="mb-1.5 block text-sm font-medium" htmlFor={key}>{label}</label>
              <Input id={key} value={payment[key]} placeholder={placeholder} onChange={(event) => setPayment({ ...payment, [key]: event.target.value })} />
            </div>
          ))}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="pay-note">Note on the bill</label>
          <Input id="pay-note" value={payment.note} placeholder="Pay from the company account and share the reference." onChange={(event) => setPayment({ ...payment, note: event.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium" htmlFor="rzp-key">Razorpay Key ID</label>
            <Input id="rzp-key" value={payment.razorpayKeyId} placeholder="rzp_live_..." autoComplete="off" onChange={(event) => setPayment({ ...payment, razorpayKeyId: event.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="rzp-secret">Razorpay Key Secret</label>
            <Input id="rzp-secret" type="password" autoComplete="new-password" value={payment.razorpayKeySecret} placeholder={gateway.razorpayReady ? 'Saved. Leave blank to keep it.' : 'Key secret'} onChange={(event) => setPayment({ ...payment, razorpayKeySecret: event.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="rzp-hook">Razorpay webhook secret</label>
            <Input id="rzp-hook" type="password" autoComplete="new-password" value={payment.razorpayWebhookSecret} placeholder={gateway.webhookReady ? 'Saved. Leave blank to keep it.' : 'Webhook secret'} onChange={(event) => setPayment({ ...payment, razorpayWebhookSecret: event.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Webhook URL for Razorpay, event payment.captured: {webhookUrl()}
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Companies this month</h2>
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No companies yet.</TableCell>
                </TableRow>
              )}
              {subscriptions.map((row) => (
                <TableRow key={row.tenantId}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="max-w-[22rem] whitespace-normal text-xs text-muted-foreground">{row.message}</p>
                  </TableCell>
                  <TableCell className="capitalize">{row.plan}</TableCell>
                  <TableCell>
                    {row.orders}
                    {row.lines?.some((line) => line.orders) && (
                      <p className="text-xs text-muted-foreground">{row.lines.filter((line) => line.orders).map((line) => `${line.channel} ${line.orders}`).join(' · ')}</p>
                    )}
                  </TableCell>
                  <TableCell>₹{Number(row.bill || 0).toLocaleString('en-IN')}</TableCell>
                  <TableCell>
                    <Badge variant={row.monthStatus === 'paid' ? 'outline' : row.tone === 'warn' ? 'destructive' : 'secondary'}>
                      {row.monthStatus === 'paid' ? 'Paid' : row.monthStatus === 'submitted' ? 'Payment sent' : row.status === 'trial' ? 'Trial' : row.status === 'expired' ? 'Trial ended' : row.status === 'suspended' ? 'Suspended' : 'Due'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.monthStatus !== 'paid' && row.status !== 'suspended' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={marking === row.tenantId}
                        onClick={async () => {
                          setMarking(row.tenantId);
                          try {
                            const { data } = await api.post(`/pricing/subscriptions/${row.tenantId}/payments`, { amount: row.bill });
                            setSubscriptions((current) => current.map((item) => (item.tenantId === row.tenantId ? data.data : item)));
                            toast.success(`${row.name} marked paid for this month`);
                          } catch (err) {
                            toast.error(apiError(err, 'Could not record the payment'));
                          } finally {
                            setMarking('');
                          }
                        }}
                      >
                        {marking === row.tenantId ? 'Saving…' : row.monthStatus === 'submitted' ? 'Confirm payment' : 'Mark paid'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Pricing requests</h2>
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">No pricing requests yet.</TableCell>
                </TableRow>
              )}
              {inquiries.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.company || '—'}</p>
                    <p className="text-xs text-muted-foreground">{row.city || '—'} · {new Date(row.createdAt).toLocaleString()}</p>
                  </TableCell>
                  <TableCell>
                    <p>{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                    <p className="text-xs text-muted-foreground">{row.phone || '—'}</p>
                  </TableCell>
                  <TableCell>{[row.orders && `${row.orders} orders`, row.products && `${row.products} products`, row.channels].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="max-w-[16rem] whitespace-normal text-sm">{row.message || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      </div>
    </PlatformPage>
  );
}
