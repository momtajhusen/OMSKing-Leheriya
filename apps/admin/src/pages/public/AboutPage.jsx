import { Warehouse, Shield, Scale, Handshake, Crown, Store, Info, Heart, Milestone, Users, Radio, ArrowRight, PackageOpen, Barcode, MapPin } from 'lucide-react';
import { IconWell, MarketingCta, MktCard, RoleGrid } from '../../components/marketing/MarketingCta';
import { PageHero, SectionHeading, Reveal, CtaBand } from '../../components/marketing/MktKit';
import MktImage from '../../components/marketing/MktImage';

const values = [
  { icon: Warehouse, tone: 'amber', title: 'Ops first', text: 'Screens match Leheriya’s packing table, WH-001 / WH-002 and GST files — not a generic SaaS template.' },
  { icon: Shield, tone: 'blue', title: 'Tenant walls', text: 'A merchant Super Admin stays inside their own brand. Another company’s orders never appear.' },
  { icon: Scale, tone: 'violet', title: 'India rules we actually coded', text: 'Shopify GST invoice = Order ID. Partially paid = COD. Same phone allowed on more than one vendor.' },
  { icon: Handshake, tone: 'emerald', title: 'Vendor honest', text: 'Vendors get assigned Master Order rows only. No other vendor’s rates, no finance tabs.' },
];

const milestones = [
  { icon: PackageOpen, image: 'about-journey-packing-table', label: 'Where it started', title: 'Leheriya’s packing table', text: 'An operations desk for Leheriya Creations, Jaipur: one Master Order, WH-001 offline and WH-002 virtual stock, GST on the order.' },
  { icon: Barcode, image: 'about-journey-stock-ledger', label: 'Stock you can trust', title: 'Master SKU and stock ledger', text: 'Every listing maps to a Master SKU. Reservations and a ledger per warehouse, so the same unit is never sold twice.' },
  { icon: Handshake, image: 'about-journey-vendor-network', label: 'The vendor network', title: 'Vendor portal and per-item assign', text: 'Lines without offline stock go to vendors. Vendors accept, dispatch and add an AWB from their own portal.' },
  { icon: Radio, image: 'about-journey-seven-channels', label: 'Now live', title: 'Seven channels on one desk', text: 'Shopify, Amazon and Myntra natively; Flipkart, Meesho, AJIO and Nykaa through the seller API connector. Every merchant in its own tenant.' },
];

export default function AboutPage() {
  return (
    <div>
      <PageHero
        eyebrow="About OMSKing"
        icon={Info}
        title="Born at a packing table,"
        highlight="built for every channel."
        text="OMSKing started as Leheriya Creations’ operations system — Jaipur fashion with Master SKU, two warehouses and a vendor network. It is now a multichannel OMS: Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa on one desk, and every subscriber gets the same locked tenant."
        aside={(
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Store, title: 'First tenant', text: 'Leheriya Creations' },
              { icon: Radio, title: 'Sales channels', text: '7 + partner API' },
              { icon: Crown, title: 'Merchant login', text: 'Super Admin · Operations · Warehouse · Accounts · Vendor' },
              { icon: Shield, title: 'Isolation', text: 'One tenant per merchant' },
            ].map((item, index) => (
              <div
                key={item.title}
                className={`mkt-float rounded-3xl border border-white/15 bg-white/10 p-5 text-white backdrop-blur ${index % 2 ? 'mkt-float-delay mt-6' : ''}`}
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-lime-400 text-emerald-950 shadow-lg">
                  <item.icon className="h-5 w-5" />
                </span>
                <p className="text-sm font-bold">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-emerald-50/80">{item.text}</p>
              </div>
            ))}
          </div>
        )}
      />

      <section className="bg-white pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading
              align="left"
              className="mb-6"
              eyebrow="Our story"
              icon={MapPin}
              title="Made in Jaipur,"
              highlight="next to the fabric"
              text="Leheriya Creations prints, packs and ships from Jaipur. OMSKing was built beside that table, so every screen follows how a real order leaves a real studio."
            />
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Warehouse, label: 'WH-001 offline', hint: 'Every channel' },
                { icon: Store, label: 'WH-002 virtual', hint: 'Shopify stock' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><item.icon className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.hint}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Reveal className="relative">
            <div className="pointer-events-none absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-rose-200/40 via-amber-100/40 to-emerald-200/60 blur-2xl" />
            <MktImage name="about-jaipur-studio" className="shadow-[0_40px_80px_-40px_rgba(13,92,69,0.55)] ring-1 ring-emerald-100" />
          </Reveal>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Who logs in" icon={Users} title="Every role has" highlight="its own lane" />
          <RoleGrid />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How we work" icon={Heart} title="Principles we" highlight="actually coded" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((item, index) => (
              <Reveal key={item.title} delay={index * 90}>
                <MktCard icon={item.icon}>
                  <IconWell icon={item.icon} tone={item.tone} />
                  <h3 className="font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </MktCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <SectionHeading eyebrow="Journey" icon={Milestone} title="From one brand to" highlight="a multichannel OMS" />
          <ol className="relative space-y-8 before:absolute before:bottom-2 before:left-5 before:top-2 before:w-0.5 before:bg-gradient-to-b before:from-emerald-500 before:via-lime-400 before:to-teal-500 sm:before:left-1/2">
            {milestones.map((item, index) => {
              const last = index === milestones.length - 1;
              return (
                <Reveal as="li" key={item.title} delay={index * 100} className="relative grid gap-4 pl-14 sm:grid-cols-2 sm:pl-0">
                  <span
                    className={`absolute left-5 top-5 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-lg ring-4 ring-white sm:left-1/2 ${last ? 'from-lime-400 to-emerald-500 shadow-lime-500/40' : 'from-emerald-500 to-teal-600 shadow-emerald-500/30'}`}
                  >
                    {last && <span className="absolute inset-0 animate-ping rounded-full bg-lime-400/50" />}
                    <item.icon className="relative h-[18px] w-[18px]" strokeWidth={2.1} />
                  </span>
                  <div className={index % 2 ? 'sm:col-start-2 sm:pl-12' : 'sm:pr-12 sm:text-right'}>
                    <MktCard icon={item.icon} className={last ? 'border-emerald-300 bg-gradient-to-br from-white to-emerald-50' : ''}>
                      <MktImage name={item.image} className="-mx-6 -mt-6 mb-5 rounded-none rounded-t-3xl" />
                      <p className={`text-xs font-bold uppercase tracking-[0.14em] ${last ? 'text-lime-700' : 'text-emerald-700'}`}>{item.label}</p>
                      <p className="mt-1 text-lg font-bold text-slate-900">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                    </MktCard>
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </div>
      </section>

      <CtaBand eyebrow="Work with us" title="Your brand could be" highlight="tenant two.">
        <MarketingCta to="/contact" className="px-7 py-3.5">
          Work with us
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </MarketingCta>
        <MarketingCta to="/demo" variant="glass" className="px-7 py-3.5">Request a demo</MarketingCta>
      </CtaBand>
    </div>
  );
}
