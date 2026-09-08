import { useState } from 'react';
import { Mail, Phone, MapPin, PlayCircle, BadgeIndianRupee, LifeBuoy } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { IconWell, MktCard } from '../../components/marketing/MarketingCta';

export default function ContactPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    interest: 'demo',
    message: '',
  });
  const [sending, setSending] = useState(false);

  const onChange = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const onSubmit = (event) => {
    event.preventDefault();
    setSending(true);
    setTimeout(() => {
      setSending(false);
      toast.success('Message sent. We will reply within one working day.');
      setForm({ name: '', email: '', company: '', phone: '', interest: 'demo', message: '' });
    }, 600);
  };

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-violet-50 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Contact</h1>
          <p className="mt-3 text-lg text-slate-600">
            Tell us if you want a Leheriya demo, a price for your order volume, or help on a tenant you already have. Someone on our team reads every message.
          </p>
        </div>
      </section>

      <section className="bg-white py-10">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:grid-cols-3 sm:px-6">
          {[
            { icon: PlayCircle, tone: 'blue', title: 'Leheriya walkthrough', text: 'Master Order, WH-001 / WH-002, GST on Order ID' },
            { icon: BadgeIndianRupee, tone: 'amber', title: 'Tenant plan', text: 'Shopify · Amazon · Myntra × monthly orders' },
            { icon: LifeBuoy, tone: 'emerald', title: 'Existing tenant', text: 'Users, roles and warehouse help for a company you already run' },
          ].map((item) => (
            <MktCard key={item.title} className="text-center">
              <IconWell icon={item.icon} tone={item.tone} className="mx-auto" />
              <p className="font-bold text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-500">{item.text}</p>
            </MktCard>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-16">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900">Reach us</h2>
            {[
              { icon: Mail, tone: 'blue', title: 'Email', value: 'contact@omsking.com' },
              { icon: Phone, tone: 'emerald', title: 'Phone', value: '+91 98765 43210' },
              { icon: MapPin, tone: 'amber', title: 'Studio', value: 'Jaipur, Rajasthan' },
            ].map((item) => (
              <MktCard key={item.title} className="flex items-start gap-4">
                <IconWell icon={item.icon} tone={item.tone} className="mb-0 shrink-0" />
                <div className="pt-1">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="text-sm text-slate-600">{item.value}</p>
                </div>
              </MktCard>
            ))}
          </div>

          <form onSubmit={onSubmit} className="rounded-2xl border border-white bg-white p-6 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.18)]">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="name">Name*</label>
                <Input id="name" name="name" required value={form.name} onChange={onChange} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="email">Email*</label>
                <Input id="email" name="email" type="email" required value={form.email} onChange={onChange} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="company">Company</label>
                <Input id="company" name="company" value={form.company} onChange={onChange} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="phone">Mobile</label>
                <Input id="phone" name="phone" value={form.phone} onChange={onChange} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium" htmlFor="interest">I need</label>
                <select
                  id="interest"
                  name="interest"
                  value={form.interest}
                  onChange={onChange}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="demo">A Leheriya demo</option>
                  <option value="pricing">A price for my monthly orders</option>
                  <option value="tenant">Help with my existing account</option>
                  <option value="other">Something else</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium" htmlFor="message">Message*</label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={5}
                  value={form.message}
                  onChange={onChange}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <Button type="submit" disabled={sending} className="mt-5 rounded-full !bg-blue-600 !from-blue-600 !to-indigo-600">
              {sending ? 'Sending…' : 'Send message'}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
