import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin, PlayCircle, BadgeIndianRupee, LifeBuoy, MessageCircle, Send, ArrowUpRight, Clock } from 'lucide-react';
import { PageHero, SectionHeading, Reveal } from '../../components/marketing/MktKit';
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF, CONTACT_WHATSAPP_DISPLAY, CONTACT_WHATSAPP_HREF, CONTACT_HOURS } from '../../components/marketing/StickyContactDock';
import { LEGAL_LINKS } from './LegalPage';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { IconWell, MktCard } from '../../components/marketing/MarketingCta';
import MktImage from '../../components/marketing/MktImage';

export default function ContactPage() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    interest: 'tenant',
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
      setForm({ name: '', email: '', company: '', phone: '', interest: 'tenant', message: '' });
    }, 600);
  };

  return (
    <div>
      <PageHero
        compact
        eyebrow="Contact"
        icon={MessageCircle}
        title="Let’s talk about"
        highlight="your order desk."
        text="This page is for a question about a company you already run, or a price. A demo request is a separate form and does not create a login."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/20">
            <Mail className="h-4 w-4" /> {CONTACT_EMAIL}
          </a>
          <a href={CONTACT_PHONE_HREF} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/20">
            <Phone className="h-4 w-4" /> {CONTACT_PHONE_DISPLAY}
          </a>
          <a href={CONTACT_WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white/20">
            <MessageCircle className="h-4 w-4" /> {CONTACT_WHATSAPP_DISPLAY}
          </a>
          <Link to="/demo" className="inline-flex items-center gap-2 rounded-full bg-lime-300 px-4 py-2 text-sm font-semibold text-emerald-950 transition duration-300 hover:-translate-y-0.5 hover:bg-lime-200">
            Request a demo <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </PageHero>

      <section className="relative z-10 -mt-12 pb-6">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:grid-cols-3 sm:px-6">
          {[
            { icon: PlayCircle, tone: 'blue', title: 'Leheriya walkthrough', text: 'Master Order, WH-001 / WH-002, GST on Order ID' },
            { icon: BadgeIndianRupee, tone: 'amber', title: 'Tenant plan', text: 'Your channels × monthly orders — Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO, Nykaa' },
            { icon: LifeBuoy, tone: 'emerald', title: 'Existing tenant', text: 'Users, roles and warehouse help for a company you already run' },
          ].map((item, index) => (
            <Reveal key={item.title} delay={index * 90}>
              <MktCard className="text-center">
                <IconWell icon={item.icon} tone={item.tone} className="mx-auto" />
                <p className="font-bold text-slate-900">{item.title}</p>
                <p className="mt-1 text-sm text-slate-500">{item.text}</p>
              </MktCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-gradient-to-b from-white to-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Reach us" icon={Send} title="Write to us," highlight="we reply fast" />
        </div>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4">
            <Reveal className="relative">
              <MktImage name="contact-support-team" className="shadow-[0_30px_60px_-30px_rgba(13,92,69,0.5)] ring-4 ring-white" />
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-emerald-800 shadow backdrop-blur">
                <Clock className="h-3.5 w-3.5" /> {CONTACT_HOURS}
              </span>
            </Reveal>
            {[
              { icon: Mail, tone: 'blue', title: 'Mail us', value: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
              { icon: Phone, tone: 'emerald', title: 'Call us', value: CONTACT_PHONE_DISPLAY, href: CONTACT_PHONE_HREF },
              { icon: MessageCircle, tone: 'emerald', title: 'WhatsApp only', value: CONTACT_WHATSAPP_DISPLAY, href: CONTACT_WHATSAPP_HREF, external: true },
              { icon: Clock, tone: 'violet', title: 'Working hours', value: CONTACT_HOURS },
              { icon: MapPin, tone: 'amber', title: 'Studio', value: 'Jaipur, Rajasthan' },
            ].map((item, index) => (
              <Reveal key={item.title} delay={index * 80}>
                <MktCard className="flex items-center gap-4 p-5">
                  <IconWell icon={item.icon} tone={item.tone} className="mb-0 h-12 w-12 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{item.title}</p>
                    {item.href ? (
                      <a
                        href={item.href}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noopener noreferrer' : undefined}
                        className="block truncate font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {item.value}
                      </a>
                    ) : (
                      <p className="font-semibold text-slate-900">{item.value}</p>
                    )}
                  </div>
                  {item.href && <ArrowUpRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-600" />}
                </MktCard>
              </Reveal>
            ))}
            <nav className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-sm" aria-label="Legal">
              {LEGAL_LINKS.map((item) => (
                <Link key={item.to} to={item.to} className="font-medium text-emerald-800 hover:underline">{item.label}</Link>
              ))}
            </nav>
          </div>

          <Reveal delay={120} as="form" onSubmit={onSubmit} className="relative rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_30px_60px_-30px_rgba(13,92,69,0.35)] sm:p-8">
            <span className="absolute inset-x-8 top-0 h-1 rounded-b-full bg-gradient-to-r from-emerald-500 via-lime-400 to-teal-500" />
            <h3 className="mb-5 text-xl font-bold text-slate-900">Send a message</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="name">Name*</label>
                <Input id="name" name="name" required value={form.name} onChange={onChange} className="mkt-field h-11 rounded-xl bg-slate-50" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="email">Email*</label>
                <Input id="email" name="email" type="email" required value={form.email} onChange={onChange} className="mkt-field h-11 rounded-xl bg-slate-50" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="company">Company</label>
                <Input id="company" name="company" value={form.company} onChange={onChange} className="mkt-field h-11 rounded-xl bg-slate-50" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="phone">Mobile</label>
                <Input id="phone" name="phone" value={form.phone} onChange={onChange} className="mkt-field h-11 rounded-xl bg-slate-50" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium" htmlFor="interest">I need</label>
                <select
                  id="interest"
                  name="interest"
                  value={form.interest}
                  onChange={onChange}
                  className="mkt-field h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
                >
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
                  className="mkt-field w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <Button type="submit" disabled={sending} className="mt-6 h-12 rounded-full px-8">
              <Send className="mr-2 h-4 w-4" />
              {sending ? 'Sending…' : 'Send message'}
            </Button>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
