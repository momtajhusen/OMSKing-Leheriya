import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Building2, CalendarClock, Phone, Store } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner } from '../../components/ui/FormBanner';
import { MktCard } from '../../components/marketing/MarketingCta';
import api, { apiFormError } from '../../lib/api';

const ORDER_BANDS = [
  { value: 'under-500', label: 'Under 500' },
  { value: '500-2000', label: '500 – 2,000' },
  { value: '2000-10000', label: '2,000 – 10,000' },
  { value: '10000-plus', label: 'More than 10,000' },
];

const CHANNELS = ['Shopify', 'Amazon', 'Myntra'];

const empty = {
  name: '',
  email: '',
  phone: '',
  company: '',
  city: '',
  monthlyOrders: '500-2000',
  channels: ['Shopify'],
  message: '',
};

export default function DemoRequestPage() {
  const [form, setForm] = useState(empty);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  const toggleChannel = (name) => {
    setForm((current) => {
      const has = current.channels.includes(name);
      const channels = has ? current.channels.filter((item) => item !== name) : [...current.channels, name];
      return { ...current, channels };
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!form.channels.length) {
      setError('Choose at least one channel.');
      return;
    }
    setSending(true);
    try {
      await api.post('/demo-requests', form);
      setDone(true);
      toast.success('Demo request received');
    } catch (err) {
      setError(apiFormError(err, 'Could not send the demo request.').message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-600 px-4 py-12 text-white sm:px-6 sm:py-16">
        <div className="pointer-events-none absolute -left-10 top-0 h-48 w-48 rounded-full bg-lime-300/30 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">Walkthrough</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Request a demo</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-emerald-100 sm:text-base">
            Tell us about your company. We call you and walk through orders, stock and GST on a sample desk. This does not create a login.
          </p>
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-10 sm:py-14">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4">
            {[
              { icon: CalendarClock, title: 'A booked walkthrough', text: 'We use the mobile number on this form. No account is opened from this page.' },
              { icon: Store, title: 'Your channels', text: 'Shopify, Amazon and Myntra. Say which ones you sell on today.' },
              { icon: Building2, title: 'Ready to run it yourself?', text: 'A 14-day merchant trial is a different page. You become that company’s Super Admin.' },
            ].map((item) => (
              <MktCard key={item.title} className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <item.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.text}</p>
                </div>
              </MktCard>
            ))}
            <p className="px-1 text-sm text-slate-600">
              Already have a company?{' '}
              <Link to="/auth/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link>
              {' · '}
              <Link to="/auth/register" className="font-semibold text-emerald-700 hover:underline">Start a trial</Link>
            </p>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.25)] sm:p-8">
            {done ? (
              <div className="py-8 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Phone className="h-6 w-6" />
                </span>
                <h2 className="mt-4 text-2xl font-bold text-slate-900">Request received</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                  We will call the mobile number on this form and set a walkthrough. Your company account is not created yet.
                </p>
                <Link to="/auth/register" className="mt-6 inline-flex text-sm font-semibold text-emerald-700 hover:underline">
                  Or start a 14-day trial yourself
                </Link>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
                <div className="sm:col-span-2">
                  <h2 className="text-xl font-bold text-slate-900">Your details</h2>
                  <p className="mt-1 text-sm text-slate-500">We use this only to schedule the walkthrough.</p>
                </div>
                {error && (
                  <div className="sm:col-span-2">
                    <FormBanner tone="error" title="Request not sent">{error}</FormBanner>
                  </div>
                )}
                <Field label="Full name" id="demo-name" value={form.name} onChange={(value) => setField('name', value)} required />
                <Field label="Work email" id="demo-email" type="email" value={form.email} onChange={(value) => setField('email', value)} required />
                <Field label="Mobile" id="demo-phone" value={form.phone} onChange={(value) => setField('phone', value)} placeholder="10-digit mobile" required />
                <Field label="Company" id="demo-company" value={form.company} onChange={(value) => setField('company', value)} required />
                <Field label="City" id="demo-city" value={form.city} onChange={(value) => setField('city', value)} />
                <div>
                  <label htmlFor="demo-orders" className="mb-1.5 block text-sm font-medium text-slate-700">Orders / month*</label>
                  <select
                    id="demo-orders"
                    value={form.monthlyOrders}
                    onChange={(event) => setField('monthlyOrders', event.target.value)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900"
                  >
                    {ORDER_BANDS.map((band) => (
                      <option key={band.value} value={band.value}>{band.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <p className="mb-2 text-sm font-medium text-slate-700">Channels you sell on*</p>
                  <div className="flex flex-wrap gap-2">
                    {CHANNELS.map((name) => {
                      const on = form.channels.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleChannel(name)}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}
                          aria-pressed={on}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="demo-message" className="mb-1.5 block text-sm font-medium text-slate-700">What should we show?</label>
                  <textarea
                    id="demo-message"
                    rows={4}
                    value={form.message}
                    onChange={(event) => setField('message', event.target.value)}
                    placeholder="Orders, warehouses, GST, vendor split…"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                  This form stores your name, email, mobile, and company so we can book the walkthrough.{' '}
                  <Link to="/privacy" className="font-medium text-emerald-800 hover:underline">Privacy</Link>
                </p>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={sending} className="h-12 w-full rounded-full">
                    {sending ? 'Sending…' : 'Request a demo'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, id, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}{required ? '*' : ''}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl bg-slate-50"
      />
    </div>
  );
}
