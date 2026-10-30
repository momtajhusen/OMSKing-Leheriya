import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  Check, Sparkles, Rocket, Building2, Radio, Barcode, ChevronDown, BadgeIndianRupee, Calculator, HelpCircle, Send,
  Boxes, Receipt, Handshake, Scale, LayoutGrid, Headset, Infinity as InfinityIcon, Store, Timer, ShieldCheck, TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { MarketingCta, MktCard } from '../../components/marketing/MarketingCta';
import MktImage from '../../components/marketing/MktImage';
import { PageHero, SectionHeading, Reveal, CountUp } from '../../components/marketing/MktKit';
import { SUBSCRIPTION_PLANS } from '../../constants/channelCatalog';
import api, { apiFormError } from '../../lib/api';
import { cn } from '../../lib/utils';

const faqs = [
  { icon: Timer, q: 'Is there a trial?', a: 'Yes. A 14-day trial does not charge per order. After that, the bill is the rate for that month’s orders, or the monthly minimum if usage is lower.' },
  { icon: Store, q: 'Which channels are included?', a: 'Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa. Each channel uses its own API host. Orders, listings and stock show on the same screens.' },
  { icon: ShieldCheck, q: 'How are tenants isolated?', a: 'Every row carries tenantId from the login. A Leheriya Super Admin never sees another merchant’s orders.' },
];

const planMeta = {
  starter: { icon: Sparkles, accent: 'bg-sky-400', popular: false },
  growth: { icon: Rocket, accent: 'bg-gradient-to-r from-emerald-500 to-lime-500', popular: true },
  enterprise: { icon: Building2, accent: 'bg-lime-500', popular: false },
};

const heroStats = [
  { n: 7, l: 'Sales channels', icon: Radio },
  { n: 1, l: 'Master SKU per style', icon: Barcode },
  { n: 1, l: 'Tenant per merchant', icon: Building2 },
];

const featureIcons = [
  [/unlimited/i, InfinityIcon],
  [/shopify|amazon|myntra|channel/i, Radio],
  [/inventory|stock/i, Boxes],
  [/gst|invoice/i, Receipt],
  [/vendor/i, Handshake],
  [/settlement/i, Scale],
  [/module/i, LayoutGrid],
  [/support/i, Headset],
];

function featureIcon(feature) {
  return featureIcons.find(([pattern]) => pattern.test(feature))?.[1] || Check;
}

function inr(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);
}

export default function PricingPage() {
  const [card, setCard] = useState(null);
  const [orders, setOrders] = useState('1000');
  const [quote, setQuote] = useState(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    orders: '',
    products: '',
    channels: '',
    city: '',
    state: '',
    message: '',
  });

  useEffect(() => {
    api.get('/pricing').then(({ data }) => setCard(data.data)).catch(() => setCard(null));
  }, []);

  useEffect(() => {
    if (!card) return undefined;
    const handle = setTimeout(() => {
      api.get('/pricing', { params: { orders } })
        .then(({ data }) => setQuote(data.data?.quote || null))
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [card, orders]);

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    setSending(true);
    try {
      await api.post('/pricing/inquiries', form);
      toast.success('Pricing request saved. We will reply with a plan fit.');
      setForm({
        name: '', email: '', phone: '', company: '', orders: '', products: '',
        channels: '', city: '', state: '', message: '',
      });
    } catch (err) {
      setFormError(apiFormError(err, 'Could not save the pricing request.').message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHero
        eyebrow="Pricing"
        icon={BadgeIndianRupee}
        title="Pay per order."
        highlight="Nothing per seat."
        text={card
          ? `As low as ${inr(card.lowestRate)} per order. A quiet month still pays the ${inr(card.minimumMonthly)} minimum.`
          : 'Charged per order, with a monthly minimum.'}
      >
        <div className="mx-auto grid max-w-2xl grid-cols-3 gap-3">
          {heroStats.map((stat) => (
            <div key={stat.l} className="rounded-2xl border border-white/15 bg-white/10 px-3 py-4 backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white/15">
              <stat.icon className="mx-auto mb-2 h-5 w-5 text-lime-200" />
              <CountUp value={stat.n} className="block text-3xl font-bold text-white" />
              <div className="mt-1 text-xs text-emerald-50/80 sm:text-sm">{stat.l}</div>
            </div>
          ))}
        </div>
      </PageHero>

      <section className="bg-gradient-to-b from-slate-50 to-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {card && (
            <div className="mb-20 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Reveal>
                <MktCard className="p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><BadgeIndianRupee className="h-5 w-5" /></span>
                    <h2 className="text-2xl font-bold text-slate-900">Per order</h2>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">More orders in the month use a lower rate. The last slab applies to the whole month.</p>
                  <table className="mt-5 w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-2 font-medium">Orders this month</th>
                        <th className="py-2 text-right font-medium">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.slabs.map((slab) => {
                        const active = quote && quote.rate === slab.rate;
                        return (
                          <tr
                            key={slab.label}
                            className={cn('border-t border-slate-100 transition-colors duration-300', active && 'bg-emerald-50')}
                          >
                            <td className={cn('px-2 py-3 text-slate-800', active && 'font-semibold text-emerald-800')}>
                              {slab.label}
                              {active && <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Your slab</span>}
                            </td>
                            <td className="px-2 py-3 text-right font-semibold text-slate-900">{inr(slab.rate)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-sm text-slate-600">Minimum {inr(card.minimumMonthly)} a month. If usage is lower, the difference is added.</p>
                </MktCard>
              </Reveal>
              <Reveal delay={120}>
                <MktCard className="bg-gradient-to-br from-white to-emerald-50/60 p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Calculator className="h-5 w-5" /></span>
                    <h2 className="text-2xl font-bold text-slate-900">Estimate</h2>
                  </div>
                  <label htmlFor="order-estimate" className="mb-1.5 mt-5 block text-sm font-medium text-slate-700">Orders this month</label>
                  <Input id="order-estimate" inputMode="numeric" className="mkt-field h-12 rounded-xl text-lg font-semibold" value={orders} onChange={(event) => setOrders(event.target.value.replace(/[^\d]/g, ''))} />
                  {quote && (
                    <dl className="mt-5 space-y-2 text-sm">
                      <div className="flex justify-between"><dt className="text-slate-500">Rate</dt><dd className="font-semibold">{inr(quote.rate)} / order</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Usage</dt><dd className="font-semibold">{inr(quote.usage)}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Minimum adjustment</dt><dd className="font-semibold">{inr(quote.adjustment)}</dd></div>
                      <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-700 px-4 py-3 text-white">
                        <dt className="font-semibold">Bill</dt>
                        <dd key={quote.bill} className="mkt-rise text-xl font-bold">{inr(quote.bill)}</dd>
                      </div>
                    </dl>
                  )}
                </MktCard>
              </Reveal>
            </div>
          )}

          <SectionHeading
            eyebrow="Trial packages"
            icon={Rocket}
            title="Same rate for everyone."
            highlight="Pick your channels."
            text="Every company pays this same rate. The trial packages below only change which channels you can connect."
          />

          <div className="mb-20 grid items-stretch gap-6 md:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan, index) => {
              const meta = planMeta[plan.id] || planMeta.starter;
              const Icon = meta.icon;
              return (
                <Reveal key={plan.id} delay={index * 100} className={meta.popular ? 'md:-mt-4' : ''}>
                  <MktCard
                    accent={meta.accent}
                    icon={Icon}
                    className={cn('flex flex-col p-7', meta.popular && 'border-emerald-300 shadow-[0_30px_60px_-28px_rgba(13,92,69,0.5)] ring-2 ring-emerald-500/30')}
                  >
                    {meta.popular && (
                      <p className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-lime-500 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
                        <Sparkles className="h-3 w-3" />
                        Most teams start here
                      </p>
                    )}
                    <div className="mkt-icon-well relative mb-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-lime-500 text-white shadow-lg shadow-emerald-500/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                      <Icon className="relative h-6 w-6" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{plan.price}</p>
                    <ul className="mt-6 flex-1 space-y-3">
                      {plan.features.map((feature) => {
                        const FeatureIcon = featureIcon(feature);
                        return (
                          <li key={feature} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-50 to-lime-50 text-emerald-700 ring-1 ring-emerald-100">
                              <FeatureIcon className="h-4 w-4" strokeWidth={2.1} />
                            </span>
                            {feature}
                          </li>
                        );
                      })}
                    </ul>
                    <MarketingCta
                      to={`/auth/register?plan=${plan.id}`}
                      variant={meta.popular ? 'solid' : 'outline'}
                      className="mt-7 w-full py-3"
                    >
                      Start {plan.name} trial
                    </MarketingCta>
                  </MktCard>
                </Reveal>
              );
            })}
          </div>

          <div className="mb-20 grid items-center gap-10 lg:grid-cols-2">
            <Reveal className="relative">
              <div className="pointer-events-none absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-emerald-200/60 via-lime-100/50 to-teal-200/60 blur-2xl" />
              <MktImage name="pricing-growth" className="shadow-[0_40px_80px_-40px_rgba(13,92,69,0.55)] ring-1 ring-emerald-100" />
            </Reveal>
            <div>
              <SectionHeading
                align="left"
                className="mb-6"
                eyebrow="Grow at your pace"
                icon={TrendingUp}
                title="Pay for orders,"
                highlight="not for seats"
                text="The bill follows that month’s orders. Every company pays the same per-order rate."
              />
              <ul className="space-y-3">
                {[
                  { icon: Timer, text: '14-day trial with no per-order charge.' },
                  { icon: BadgeIndianRupee, text: 'More orders in a month move you to a lower rate.' },
                  { icon: Scale, text: 'A monthly minimum applies only when usage is lower.' },
                ].map((point) => (
                  <li key={point.text} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-lime-500 text-white shadow-md shadow-emerald-500/25">
                      <point.icon className="h-4 w-4" />
                    </span>
                    {point.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Reveal>
              <MktCard className="p-7">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Send className="h-5 w-5" /></span>
                  <h2 className="text-2xl font-bold text-slate-900">Tell us your volume</h2>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  We quote on your channels and monthly Master Orders. Leheriya is the first tenant we sized this against.
                </p>
                <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {formError && <p className="sm:col-span-2 text-sm font-medium text-red-600" role="alert">{formError}</p>}
                  <Field label="Your name" name="name" value={form.name} onChange={onChange} required />
                  <Field label="Email" name="email" type="email" value={form.email} onChange={onChange} required />
                  <Field label="Mobile" name="phone" value={form.phone} onChange={onChange} />
                  <Field label="Company" name="company" value={form.company} onChange={onChange} />
                  <Field label="Orders / month" name="orders" value={form.orders} onChange={onChange} />
                  <Field label="Product count" name="products" value={form.products} onChange={onChange} />
                  <Field label="Channels" name="channels" value={form.channels} onChange={onChange} placeholder="Shopify, Amazon, Flipkart…" />
                  <Field label="City" name="city" value={form.city} onChange={onChange} />
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="pricing-message">Message</label>
                    <textarea
                      id="pricing-message"
                      name="message"
                      rows={4}
                      value={form.message}
                      onChange={onChange}
                      className="mkt-field w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                    />
                  </div>
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                    We keep the details on this form to reply with a quote.{' '}
                    <Link to="/privacy" className="font-medium text-emerald-800 hover:underline">Privacy</Link>
                    {' · '}
                    <Link to="/billing" className="font-medium text-emerald-800 hover:underline">Billing</Link>
                  </p>
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={sending} className="h-12 rounded-full px-8">
                      {sending ? 'Saving…' : 'Send pricing request'}
                    </Button>
                  </div>
                </form>
              </MktCard>
            </Reveal>
            <Reveal delay={120} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><HelpCircle className="h-5 w-5" /></span>
                <h2 className="text-2xl font-bold text-slate-900">FAQ</h2>
              </div>
              {faqs.map((item, index) => (
                <details key={item.q} className="mkt-faq group rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition duration-300 open:border-emerald-200 open:shadow-lg hover:border-emerald-200" open={index === 0}>
                  <summary className="flex items-center justify-between gap-4 font-semibold text-slate-900">
                    <span className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-lime-500 text-white shadow-md shadow-emerald-500/25 transition-transform duration-300 group-hover:-rotate-6">
                        <item.icon className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                      {item.q}
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-500 group-open:bg-emerald-50 group-open:text-emerald-700">
                      <ChevronDown className="mkt-faq-chevron h-4 w-4" />
                    </span>
                  </summary>
                  <p className="mkt-faq-body mt-3 text-sm leading-6 text-slate-600">{item.a}</p>
                </details>
              ))}
              <p className="px-1 text-sm text-slate-600">
                Prefer a walkthrough before you sign up?{' '}
                <Link to="/demo" className="font-medium text-emerald-700 hover:underline">Request a demo</Link>
                {' · '}
                <Link to="/billing" className="font-medium text-emerald-700 hover:underline">How billing works</Link>
              </p>
            </Reveal>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={name}>{label}{required ? '*' : ''}</label>
      <Input id={name} name={name} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} className="mkt-field h-11 rounded-xl bg-slate-50" />
    </div>
  );
}
