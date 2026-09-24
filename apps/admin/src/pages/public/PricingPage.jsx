import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Check, Sparkles, Rocket, Building2, Radio, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { MarketingCta, MktCard } from '../../components/marketing/MarketingCta';
import { SUBSCRIPTION_PLANS } from '../../mocks';

const faqs = [
  { q: 'Is there a trial?', a: 'Yes. Register a merchant trial — you become that company’s Super Admin.' },
  { q: 'Which channels at launch?', a: 'Shopify, Amazon and Myntra only. Flipkart or others can be added later per tenant — they are not in the first build.' },
  { q: 'How are tenants isolated?', a: 'Every row carries tenantId from the login. A Leheriya Super Admin never sees another merchant’s orders.' },
];

const planMeta = {
  starter: { icon: Sparkles, accent: 'bg-sky-400', popular: false },
  growth: { icon: Rocket, accent: 'bg-emerald-600', popular: true },
  enterprise: { icon: Building2, accent: 'bg-lime-500', popular: false },
};

export default function PricingPage() {
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

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = (event) => {
    event.preventDefault();
    toast.success('Pricing request sent. We will reply with a plan fit.');
    setForm({
      name: '', email: '', phone: '', company: '', orders: '', products: '',
      channels: '', city: '', state: '', message: '',
    });
  };

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-600 px-4 py-10 text-center text-white sm:px-6 sm:py-16">
        <div className="pointer-events-none absolute -left-10 top-0 h-48 w-48 rounded-full bg-lime-300/30 blur-3xl animate-float" />
        <div className="pointer-events-none absolute -right-10 bottom-0 h-48 w-48 rounded-full bg-emerald-300/30 blur-3xl animate-float-slow" />
        <div className="relative mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Pricing</h1>
          <p className="mt-3 text-sm leading-6 text-emerald-100 sm:text-base">
            Per tenant. Priced on Shopify / Amazon / Myntra and monthly Master Orders — not a credit pack.
          </p>
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-8 sm:py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-8 grid gap-3 sm:-mt-16 sm:mb-12 sm:grid-cols-3 sm:gap-4">
            {[
              { n: '3', l: 'Launch channels', icon: Radio },
              { n: '23', l: 'Ops modules', icon: Layers },
              { n: '1', l: 'Tenant per merchant', icon: Building2 },
            ].map((stat) => (
              <div key={stat.l} className="rounded-2xl bg-white px-6 py-5 text-center shadow-lg ring-1 ring-slate-100">
                <stat.icon className="mx-auto mb-2 h-5 w-5 text-emerald-600" />
                <div className="text-3xl font-bold text-emerald-700">{stat.n}</div>
                <div className="text-sm text-slate-600">{stat.l}</div>
              </div>
            ))}
          </div>

          <p className="mx-auto mb-8 max-w-2xl px-1 text-center text-base font-semibold leading-6 text-slate-800 sm:mb-10 sm:text-lg">
            Plans from ₹2,999 / month. Growth adds the vendor portal and Amazon / Myntra settlement matching.
          </p>

          <div className="mb-16 grid items-stretch gap-6 md:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => {
              const meta = planMeta[plan.id] || planMeta.starter;
              const Icon = meta.icon;
              return (
                <MktCard
                  key={plan.id}
                  accent={meta.accent}
                  className={meta.popular ? 'md:-mt-3 md:mb-3 ring-2 ring-emerald-500/30' : ''}
                >
                  {meta.popular && (
                    <p className="mb-3 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Most teams start here
                    </p>
                  )}
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-emerald-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{plan.price}</p>
                  <ul className="mt-5 space-y-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2 text-sm text-slate-700">
                        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <MarketingCta
                    to="/contact"
                    variant={meta.popular ? 'solid' : 'outline'}
                    className="mt-6 w-full"
                  >
                    {plan.id === 'enterprise' ? 'Talk to us' : 'Request this plan'}
                  </MarketingCta>
                </MktCard>
              );
            })}
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <MktCard>
              <h2 className="text-2xl font-bold text-slate-900">Tell us your volume</h2>
              <p className="mt-2 text-sm text-slate-600">
                We quote on launch channels and monthly Master Orders. Leheriya is the first tenant we sized this against.
              </p>
              <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Your name" name="name" value={form.name} onChange={onChange} required />
                <Field label="Email" name="email" type="email" value={form.email} onChange={onChange} required />
                <Field label="Mobile" name="phone" value={form.phone} onChange={onChange} />
                <Field label="Company" name="company" value={form.company} onChange={onChange} />
                <Field label="Orders / month" name="orders" value={form.orders} onChange={onChange} />
                <Field label="Product count" name="products" value={form.products} onChange={onChange} />
                <Field label="Channels" name="channels" value={form.channels} onChange={onChange} placeholder="Shopify, Amazon…" />
                <Field label="City" name="city" value={form.city} onChange={onChange} />
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Message</label>
                  <textarea
                    name="message"
                    rows={4}
                    value={form.message}
                    onChange={onChange}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" className="rounded-full">
                    Send pricing request
                  </Button>
                </div>
              </form>
            </MktCard>
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-slate-900">FAQ</h2>
              {faqs.map((item) => (
                <MktCard key={item.q}>
                  <h3 className="font-semibold text-slate-900">{item.q}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.a}</p>
                </MktCard>
              ))}
              <p className="px-1 text-sm text-slate-600">
                Prefer a tenant walkthrough?{' '}
                <Link to="/contact" className="font-medium text-emerald-700 hover:underline">Open contact</Link>
              </p>
            </div>
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
      <Input id={name} name={name} type={type} value={value} onChange={onChange} required={required} placeholder={placeholder} />
    </div>
  );
}
