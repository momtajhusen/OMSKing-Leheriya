import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Building2, CalendarClock, Phone, Store, PlayCircle, Check } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner } from '../../components/ui/FormBanner';
import { MktCard } from '../../components/marketing/MarketingCta';
import { PageHero, Reveal } from '../../components/marketing/MktKit';
import MktImage from '../../components/marketing/MktImage';
import api, { apiFormError } from '../../lib/api';

const ORDER_BANDS = [
  { value: 'under-500', label: 'Under 500' },
  { value: '500-2000', label: '500 – 2,000' },
  { value: '2000-10000', label: '2,000 – 10,000' },
  { value: '10000-plus', label: 'More than 10,000' },
];

const CHANNELS = ['Shopify', 'Amazon', 'Myntra', 'Flipkart', 'Meesho', 'AJIO', 'Nykaa'];

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
      <PageHero
        compact
        eyebrow="Walkthrough"
        icon={PlayCircle}
        title="Request a demo"
        highlight="of your order desk."
        text="Tell us about your company. We call you and walk through orders, stock and GST on a sample desk. This does not create a login."
      />

      <section className="relative z-10 -mt-12 bg-transparent pb-14">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4 lg:pt-16">
            <Reveal className="relative mb-6">
              <MktImage name="demo-walkthrough" className="shadow-[0_30px_60px_-30px_rgba(13,92,69,0.5)] ring-4 ring-white" />
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-emerald-800 shadow backdrop-blur">
                <PlayCircle className="h-3.5 w-3.5" /> Live walkthrough on a sample desk
              </span>
            </Reveal>
            <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 lg:text-emerald-700">What happens next</p>
            <ol className="relative space-y-4 before:absolute before:bottom-6 before:left-[2.6rem] before:top-6 before:w-0.5 before:bg-gradient-to-b before:from-emerald-400 before:to-lime-300">
              {[
                { icon: CalendarClock, title: 'A booked walkthrough', text: 'We use the mobile number on this form. No account is opened from this page.' },
                { icon: Store, title: 'Your channels', text: 'Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO or Nykaa. Pick every one you sell on today.' },
                { icon: Building2, title: 'Ready to run it yourself?', text: 'A 14-day merchant trial is a different page. You become that company’s Super Admin.' },
              ].map((item, index) => (
                <Reveal as="li" key={item.title} delay={index * 100} className="relative">
                  <MktCard className="flex items-start gap-4 p-5">
                    <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg ring-4 ring-white transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                      <item.icon className="h-5 w-5" />
                      <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white ring-2 ring-white">{index + 1}</span>
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{item.text}</p>
                    </div>
                  </MktCard>
                </Reveal>
              ))}
            </ol>
            <p className="px-1 text-sm text-slate-600">
              Already have a company?{' '}
              <Link to="/auth/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link>
              {' · '}
              <Link to="/auth/register" className="font-semibold text-emerald-700 hover:underline">Start a trial</Link>
            </p>
          </div>

          <Reveal delay={120} className="relative rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_40px_80px_-40px_rgba(13,92,69,0.45)] sm:p-8">
            <span className="absolute inset-x-8 top-0 h-1 rounded-b-full bg-gradient-to-r from-emerald-500 via-lime-400 to-teal-500" />
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
                    className="mkt-field h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900"
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
                          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 ease-premium hover:-translate-y-0.5 active:scale-95 ${on ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-[0_6px_16px_-8px_rgba(5,150,105,0.6)]' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200'}`}
                          aria-pressed={on}
                        >
                          <Check className={`h-3.5 w-3.5 transition-all duration-300 ${on ? 'w-3.5 opacity-100' : 'w-0 opacity-0'}`} strokeWidth={3} />
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
                    className="mkt-field w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
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
          </Reveal>
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
        className="mkt-field h-11 rounded-xl bg-slate-50"
      />
    </div>
  );
}
