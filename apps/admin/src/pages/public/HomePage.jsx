import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Warehouse, Truck, RotateCcw, FileSpreadsheet, CreditCard,
  ArrowRight, Layers, Barcode, Store, Handshake, Building2, ShoppingBag,
  BarChart3, Bell, Webhook, ShieldCheck, Radio, Users, Sparkles, Workflow, PlayCircle,
  RefreshCw, Receipt, Route, Split, Tags, Undo2, PackageCheck, BellRing, PackagePlus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import MktImage from '../../components/marketing/MktImage';
import { cn } from '../../lib/utils';
import { MarketingCta, IconWell, MktCard, ChannelPills, OrderFlow, RoleGrid } from '../../components/marketing/MarketingCta';
import {
  Reveal, SectionHeading, Eyebrow, HeroBackdrop, CountUp, ChannelMarquee, CtaBand, CHANNEL_DOTS,
} from '../../components/marketing/MktKit';

const stats = [
  { icon: Radio, value: 7, label: 'Sales channels', hint: 'Plus a partner API' },
  { icon: Barcode, value: 1, label: 'Master SKU', hint: 'Per style, every channel' },
  { icon: Warehouse, value: 2, label: 'Warehouse types', hint: 'Offline · Virtual' },
  { icon: RefreshCw, value: 15, suffix: ' min', label: 'Auto sync', hint: 'Orders, listings, returns' },
  { icon: Bell, value: 4, label: 'Alert channels', hint: 'Email · WhatsApp · Telegram · App' },
  { icon: Receipt, value: 'GST', label: 'CGST / SGST / IGST', hint: 'From the ship-to state' },
];

const audiences = [
  {
    icon: Store,
    tone: 'emerald',
    accent: 'bg-gradient-to-r from-emerald-400 to-teal-500',
    image: 'home-audience-d2c',
    title: 'D2C brands on Shopify',
    text: 'Shopify orders, vendors and opening stock come in on their own. Labels and cancels flow back to the store.',
  },
  {
    icon: ShoppingBag,
    tone: 'amber',
    accent: 'bg-gradient-to-r from-amber-400 to-orange-500',
    image: 'home-audience-marketplace',
    title: 'Marketplace sellers',
    text: 'Amazon, Flipkart, Myntra, Meesho, AJIO and Nykaa orders on one desk. Payout files match the same Master Orders.',
  },
  {
    icon: Handshake,
    tone: 'rose',
    accent: 'bg-gradient-to-r from-rose-400 to-pink-500',
    image: 'home-audience-vendors',
    title: 'Brands with vendors',
    text: 'Lines with no offline stock go to the vendor network. Vendors see only their own lines in their own portal.',
  },
];

const pillars = [
  {
    icon: Layers,
    tone: 'sky',
    accent: 'bg-gradient-to-r from-teal-400 to-emerald-600',
    title: 'One Master Order',
    text: 'Every connected channel lands as one Master Order with the channel’s own number, e.g. 68798-LEH. If qty is more than 1, that row can split across vendors.',
  },
  {
    icon: Barcode,
    tone: 'amber',
    accent: 'bg-gradient-to-r from-amber-400 to-orange-400',
    title: 'Stock counted once',
    text: 'Listings map to a Master SKU, and a new Shopify SKU gets its master on the first order. WH-001 (offline) sells on every channel, WH-002 (virtual) on Shopify. A ledger, not one overwritten qty.',
  },
  {
    icon: FileSpreadsheet,
    tone: 'violet',
    accent: 'bg-gradient-to-r from-lime-400 to-emerald-500',
    title: 'GST and payouts',
    text: 'Gapless GST invoices with CGST/SGST or IGST from the ship-to state. Marketplace payout files match Master Orders. Partially paid stays COD until money lands.',
  },
];

const modules = [
  { icon: ShoppingCart, tone: 'sky', accent: 'bg-sky-400', title: 'Orders desk', text: 'Tabs that packing uses: Unfulfillable, New, Packed, Ready to ship, Cancelled, All. Every channel, one list.', wide: true },
  { icon: Barcode, tone: 'orange', accent: 'bg-orange-400', title: 'Master SKU & catalog', text: 'Listings auto-map by SKU. New ones create a master or wait in the unmapped queue — no silent oversell.' },
  { icon: Warehouse, tone: 'amber', accent: 'bg-amber-400', title: 'Inventory & warehouses', text: 'Offline and virtual warehouses, reservations, ledger and low-stock alerts. One-click opening stock from Shopify.' },
  { icon: Handshake, tone: 'rose', accent: 'bg-rose-400', title: 'Vendors & dropship', text: 'Assign a vendor per item from the order. Vendor portal: accept, reject, dispatch, AWB.' },
  { icon: Truck, tone: 'emerald', accent: 'bg-emerald-400', title: 'Shipping', text: 'Delhivery AWB, labels, manifests, pickups and tracking. Cancel a label and Shopify goes back to unfulfilled.', wide: true },
  { icon: RotateCcw, tone: 'rose', accent: 'bg-pink-400', title: 'Returns, RTO & NDR', text: 'Three reverse paths, same pattern as forward orders. Restock destination is chosen at QC.' },
  { icon: FileSpreadsheet, tone: 'violet', accent: 'bg-violet-400', title: 'GST invoicing', text: 'Gapless numbers, HSN rates, credit notes and PDF invoices. On Shopify the invoice carries the order number.' },
  { icon: CreditCard, tone: 'blue', accent: 'bg-emerald-500', title: 'Settlement matching', text: 'Upload a marketplace payout file against Master Orders. Short payouts stay visible until closed.' },
  { icon: BarChart3, tone: 'sky', accent: 'bg-cyan-400', title: 'Dashboard & reports', text: 'Daily KPIs and channel mix up top. Sales, inventory, shipping, cancellations and vendor reports behind them.' },
  { icon: Bell, tone: 'orange', accent: 'bg-amber-500', title: 'Notifications', text: 'Email, WhatsApp, Telegram and in-app alerts per event. Vendors get a ping when a line is assigned.' },
  { icon: Webhook, tone: 'slate', accent: 'bg-slate-500', title: 'Integrations', text: 'Signed channel webhooks, sync jobs with retry, and API keys per merchant. Secrets never leave the server.', wide: true },
  { icon: ShieldCheck, tone: 'blue', accent: 'bg-teal-500', title: 'Roles & audit', text: 'Permission keys decide every screen. Audit log on changes. One merchant never sees another.', wide: true },
];

const checks = [
  { icon: Route, tone: 'bg-emerald-100 text-emerald-700', text: 'A line goes to the offline warehouse when it has stock, otherwise to a vendor — oldest orders first.' },
  { icon: Split, tone: 'bg-amber-100 text-amber-700', text: 'Qty > 1 can split to different vendors on the same Master Order.' },
  { icon: Tags, tone: 'bg-rose-100 text-rose-700', text: 'Shopify’s vendor name shows on the item, and the same phone number can sit on more than one vendor.' },
  { icon: Undo2, tone: 'bg-sky-100 text-sky-700', text: 'Cancel a shipping label and Shopify returns to unfulfilled.' },
];

const deskPoints = [
  { icon: Warehouse, tone: 'bg-emerald-100 text-emerald-700', title: 'Offline stock first', text: 'A line uses WH-001 stock when it has it, otherwise it goes to a vendor.' },
  { icon: Truck, tone: 'bg-sky-100 text-sky-700', title: 'Delhivery from the order', text: 'AWB, label, manifest and pickup without leaving the Master Order.' },
  { icon: Receipt, tone: 'bg-amber-100 text-amber-700', title: 'GST invoice on the order', text: 'CGST / SGST or IGST from the ship-to state, on the same Master Order.' },
];

const heroPoints = [
  { icon: Barcode, label: 'Master SKU stock' },
  { icon: Handshake, label: 'Vendor routing' },
  { icon: Truck, label: 'Delhivery shipping' },
  { icon: Receipt, label: 'GST invoices' },
];

const heroSlides = [
  {
    image: 'home-hero-studio',
    title: 'Every channel lands on one desk',
    text: 'Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa orders become one Master Order.',
    chip: { icon: BellRing, label: 'New order · Shopify', value: '68798-LEH', tone: 'from-emerald-400 to-teal-500' },
  },
  {
    image: 'home-hero-stock',
    title: 'Stock is counted once',
    text: 'WH-001 reserves the units before anyone packs, so the same piece is never sold twice.',
    chip: { icon: PackagePlus, label: 'Reserved · WH-001', value: '2 units, offline', tone: 'from-amber-400 to-orange-500' },
  },
  {
    image: 'home-hero-vendor',
    title: 'No stock? A vendor gets the line',
    text: 'Lines without offline stock go to a vendor, who accepts and dispatches from their own portal.',
    chip: { icon: Handshake, label: 'Assigned · Vendor', value: 'Accepted', tone: 'from-rose-500 to-pink-500' },
  },
  {
    image: 'home-hero-shipping',
    title: 'Packed and shipped with Delhivery',
    text: 'AWB, label, manifest and pickup straight from the Master Order.',
    chip: { icon: Truck, label: 'Delhivery', value: 'AWB booked', tone: 'from-sky-400 to-blue-500' },
  },
  {
    image: 'home-hero-invoice',
    title: 'GST invoice and payout, matched',
    text: 'CGST / SGST or IGST from the ship-to state, and marketplace payouts matched to the order.',
    chip: { icon: Receipt, label: 'GST invoice', value: 'Ready', tone: 'from-violet-500 to-purple-500' },
  },
];

const SLIDE_MS = 5000;

function HeroShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef(null);
  const current = heroSlides[active];
  const go = (step) => setActive((current) => (current + step + heroSlides.length) % heroSlides.length);

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => go(1), SLIDE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  const onTouchEnd = (event) => {
    if (touchStart.current === null) return;
    const delta = event.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1);
  };

  return (
    <div
      className="relative mx-auto w-full max-w-[600px] pb-4 pt-6 sm:pb-6 lg:-mr-8 lg:max-w-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
      onTouchEnd={onTouchEnd}
      aria-roledescription="carousel"
      aria-label="How an order moves through OMSKing"
    >
      <div className="pointer-events-none absolute right-0 top-0 h-full w-[90%] rounded-[3rem] bg-gradient-to-br from-lime-300/30 via-emerald-300/20 to-teal-300/30 blur-3xl animate-pulse-soft" />
      <div className="pointer-events-none absolute -right-8 -top-4 h-[80%] w-[80%] rounded-full border border-dashed border-lime-200/30 animate-[spin_60s_linear_infinite] motion-reduce:animate-none" />

      <div className="relative rounded-[2rem] bg-white/10 p-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.55)] ring-1 ring-white/25 backdrop-blur">
        <div className="relative aspect-[6/5] overflow-hidden rounded-[1.6rem] [@media(min-height:900px)]:aspect-square lg:[@media(max-height:760px)]:aspect-[4/3]">
          {heroSlides.map((slide, index) => (
            <div
              key={slide.image}
              aria-hidden={index !== active}
              className={cn(
                'absolute inset-0 transition-opacity duration-700 ease-out',
                index === active ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <MktImage
                name={slide.image}
                priority={index === 0}
                className={cn('h-full rounded-none', index === active && 'mkt-kenburns')}
                aspectClassName="h-full w-full"
              />
            </div>
          ))}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-emerald-950/55 to-transparent" />
        </div>
        <span className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full bg-emerald-950/55 px-3 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-300 animate-pulse-soft" />
          Live · Leheriya Creations, Jaipur
        </span>
        <div className="absolute bottom-5 right-5 hidden items-center gap-1.5 sm:flex">
          <button type="button" onClick={() => go(-1)} aria-label="Previous slide" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-emerald-800 shadow-md backdrop-blur transition hover:bg-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next slide" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-emerald-800 shadow-md backdrop-blur transition hover:bg-white">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div key={`chip-${active}`} className="mkt-rise absolute -left-3 top-0 hidden items-center gap-3 rounded-2xl border border-white/70 bg-white/95 px-3.5 py-2.5 text-slate-900 shadow-xl backdrop-blur sm:flex">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white ${current.chip.tone}`}>
          <current.chip.icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold text-slate-400">{current.chip.label}</p>
          <p className="text-sm font-bold">{current.chip.value}</p>
        </div>
      </div>

      <div className="relative z-10 mx-3 -mt-10 rounded-[1.4rem] border border-white/70 bg-white/95 p-4 text-slate-900 shadow-2xl backdrop-blur sm:absolute sm:-left-6 sm:bottom-0 sm:mx-0 sm:mt-0 sm:w-[58%]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            Step {active + 1} of {heroSlides.length}
          </p>
          <div className="flex items-center gap-1.5">
            {heroSlides.map((item, index) => (
              <button
                key={item.image}
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show slide ${index + 1}: ${item.title}`}
                aria-current={index === active ? 'true' : undefined}
                className={cn('h-2 rounded-full transition-all duration-300', index === active ? 'w-6 bg-emerald-600' : 'w-2 bg-slate-300 hover:bg-emerald-300')}
              />
            ))}
          </div>
        </div>
        <div key={`caption-${active}`} className="mkt-rise">
          <p className="mt-1.5 text-base font-bold leading-snug text-slate-900">{current.title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">{current.text}</p>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
          <span
            key={`bar-${active}`}
            className="mkt-slide-progress block h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400"
            style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          />
        </div>
      </div>
    </div>
  );
}

function HomeHero() {
  return (
    <section className="mkt-hero relative isolate overflow-hidden lg:flex lg:min-h-[calc(100dvh-72px)] lg:flex-col">
      <HeroBackdrop />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pb-16 sm:pt-16 lg:flex-1 lg:grid-cols-[1.05fr_0.95fr] lg:py-8 lg:[@media(max-height:760px)]:py-6">
        <div className="min-w-0">
          <div className="mkt-rise">
            <Eyebrow dark>Multichannel OMS · Live with Leheriya Creations</Eyebrow>
          </div>
          <h1 className="mkt-rise mt-6 text-[2.6rem] font-bold leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-[3.4rem] xl:text-[4.2rem] lg:[@media(max-height:760px)]:text-[3rem]" style={{ '--rise-delay': '80ms' }}>
            Every channel.
            <br />
            <span className="mkt-gradient-text-light">One order desk.</span>
          </h1>
          <p className="mkt-rise mt-6 max-w-xl text-base leading-7 text-emerald-50/85 sm:text-lg lg:mt-5 lg:[@media(max-height:760px)]:mt-4" style={{ '--rise-delay': '160ms' }}>
            OMSKing pulls orders from Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa into one Master Order. Stock is counted once, lines route to your warehouse or vendors, Delhivery ships, and GST invoices follow — each merchant in a locked tenant.
          </p>
          <ul className="mkt-rise mt-6 grid max-w-md grid-cols-2 gap-x-4 gap-y-2 lg:mt-5 lg:[@media(max-height:760px)]:mt-4" style={{ '--rise-delay': '220ms' }}>
            {heroPoints.map((point) => (
              <li key={point.label} className="group flex items-center gap-2 text-sm font-medium text-emerald-50">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-lime-300/25 to-emerald-300/10 text-lime-200 ring-1 ring-white/15 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <point.icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
                {point.label}
              </li>
            ))}
          </ul>
          <div className="mkt-rise mt-8 flex flex-col gap-3 sm:flex-row lg:mt-7 lg:[@media(max-height:760px)]:mt-5" style={{ '--rise-delay': '280ms' }}>
            <MarketingCta to="/demo" className="px-7 py-3.5">
              Request a demo
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </MarketingCta>
            <MarketingCta to="/features" variant="glass" className="px-7 py-3.5">
              <PlayCircle className="h-4 w-4" />
              See all features
            </MarketingCta>
          </div>
        </div>
        <div className="mkt-rise min-w-0" style={{ '--rise-delay': '200ms' }}>
          <HeroShowcase />
        </div>
      </div>
      <div className="relative border-t border-white/10 pb-6 pt-5 lg:[@media(max-height:760px)]:pb-4 lg:[@media(max-height:760px)]:pt-4">
        <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100/70">Orders flow in from</p>
        <ChannelMarquee items={CHANNEL_DOTS} dark />
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div>
      <HomeHero />

      <section className="relative bg-white py-16 sm:py-20">
        <div className="mkt-grid-bg-light" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Connected channels"
            icon={Radio}
            title="Seven channels plug in."
            highlight="Your next one too."
            text="Native adapters for Shopify, Amazon and Myntra. A seller API connector for Flipkart, Meesho, AJIO, Nykaa — and any partner that exposes orders, listings and stock."
          />
          <ChannelPills />
        </div>
      </section>

      <section className="px-4 sm:px-6">
        <Reveal className="mkt-hero relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10">
          <div className="mkt-hero-mesh" aria-hidden="true" />
          <div className="mkt-grid-bg" aria-hidden="true" />
          <div className="relative grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((item) => (
              <div key={item.label} className="group text-center lg:border-r lg:border-white/10 lg:last:border-r-0">
                <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lime-200 ring-1 ring-white/15 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110">
                  <item.icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <CountUp value={item.value} suffix={item.suffix} className="block text-3xl font-bold text-white sm:text-4xl" />
                <p className="mt-2 text-sm font-semibold text-emerald-50">{item.label}</p>
                <p className="mt-1 text-[11px] leading-4 text-emerald-100/70">{item.hint}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section className="bg-white pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal className="relative">
            <div className="pointer-events-none absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-emerald-200/60 via-lime-100/50 to-teal-200/60 blur-2xl" />
            <MktImage name="home-order-desk" className="shadow-[0_40px_80px_-40px_rgba(13,92,69,0.55)] ring-1 ring-emerald-100" />
            <div className="mkt-float absolute -bottom-5 left-5 flex items-center gap-3 rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-xl backdrop-blur sm:left-8">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-lime-500 text-white">
                <PackageCheck className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Master Order</span>
                <span className="block text-sm font-bold text-slate-900">Packed · ready to ship</span>
              </span>
            </div>
          </Reveal>
          <div>
            <SectionHeading
              align="left"
              className="mb-8"
              eyebrow="Inside the order desk"
              icon={PackageCheck}
              title="One screen for the"
              highlight="whole packing table"
              text="Every channel’s order lands as one Master Order. The team packs, books Delhivery and prints the GST invoice from the same desk."
            />
            <ul className="space-y-3">
              {deskPoints.map((point, index) => (
                <Reveal as="li" key={point.title} delay={index * 80} className="group flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 ${point.tone}`}>
                    <point.icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block font-semibold text-slate-900">{point.title}</span>
                    <span className="block text-sm leading-6 text-slate-600">{point.text}</span>
                  </span>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="The flow"
            icon={Workflow}
            title="How an order"
            highlight="moves"
            text="Channel in → Master Order → stock check → pack → ship → settle. Sidebar stays short on purpose."
          />
          <OrderFlow />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Built for"
            icon={Sparkles}
            title="Indian brands selling on"
            highlight="more than one channel"
            text="With or without a vendor network — the same desk scales from one store to seven channels."
          />
          <div className="grid gap-6 md:grid-cols-3">
            {audiences.map((item, index) => (
              <Reveal key={item.title} delay={index * 100}>
                <MktCard accent={item.accent} icon={item.icon} className="p-7">
                  <MktImage name={item.image} className="-mx-7 -mt-7 mb-0 rounded-none rounded-t-3xl" />
                  <IconWell icon={item.icon} tone={item.tone} className="relative z-10 -mt-7" />
                  <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </MktCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Who logs in"
            icon={Users}
            title="Five roles,"
            highlight="one merchant"
            text="Super Admin, Operations, Warehouse, Accounts and Vendor — all inside one merchant, like Leheriya."
          />
          <RoleGrid />
        </div>
      </section>

      <section id="why" className="scroll-mt-24 bg-gradient-to-b from-white to-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Why OMSKing"
            title="Built around a"
            highlight="real packing table"
            text="Leheriya Creations, Jaipur fashion, runs on OMSKing today. The same tenant model is what the next subscriber gets."
          />
          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map((item, index) => (
              <Reveal key={item.title} delay={index * 100}>
                <MktCard accent={item.accent} icon={item.icon} className="p-7">
                  <span className="absolute right-6 top-6 text-5xl font-black text-slate-100 transition-colors duration-300 group-hover:text-emerald-50">
                    0{index + 1}
                  </span>
                  <IconWell icon={item.icon} tone={item.tone} />
                  <h3 className="relative text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="relative mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </MktCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Modules"
            icon={Layers}
            title="Screens the team"
            highlight="opens every day"
            text="Orders first. Stock, vendors, reverse flow and GST behind them — not a 40-item tree."
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((item, index) => (
              <Reveal key={item.title} delay={(index % 4) * 70} className={item.wide ? 'lg:col-span-2' : ''}>
                <MktCard accent={item.accent} icon={item.icon}>
                  <IconWell icon={item.icon} tone={item.tone} />
                  <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </MktCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <SectionHeading
              align="left"
              className="mb-8"
              eyebrow="One tenant"
              icon={Building2}
              title="Channels, vendors, two warehouses —"
              highlight="still one tenant"
            />
            <ul className="space-y-3">
              {checks.map((line, index) => (
                <Reveal as="li" key={line.text} delay={index * 80} className="group flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-100 transition duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:ring-emerald-100">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 ${line.tone}`}>
                    <line.icon className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="pt-1.5">{line.text}</span>
                </Reveal>
              ))}
            </ul>
          </div>
          <Reveal className="relative">
            <div className="pointer-events-none absolute inset-8 rounded-full bg-emerald-300/30 blur-3xl" />
            <MktImage name="home-one-tenant" className="shadow-[0_40px_80px_-40px_rgba(13,92,69,0.5)] ring-1 ring-emerald-100" />
            <div className="relative -mt-8 grid grid-cols-2 gap-3 px-3 sm:grid-cols-4 sm:px-5">
              {[
                { icon: Store, label: 'Shopify store', color: 'from-emerald-500 to-teal-500' },
                { icon: ShoppingBag, label: '6 marketplaces', color: 'from-amber-400 to-orange-500' },
                { icon: Building2, label: 'WH-001 · WH-002', color: 'from-sky-400 to-blue-500' },
                { icon: Handshake, label: 'Vendors', color: 'from-rose-500 to-pink-500' },
              ].map((node) => (
                <div key={node.label} className="group flex flex-col items-center gap-2 rounded-2xl border border-white/80 bg-white/95 px-2 py-3 text-center shadow-lg backdrop-blur">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110 ${node.color}`}>
                    <node.icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-semibold text-slate-800">{node.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <CtaBand
        eyebrow="Tenant one is live"
        title="Leheriya is tenant one."
        highlight="The next brand gets the same walls."
        text="Every query is scoped to the signed-in merchant. Bring your channels to one desk — start a trial or book a walkthrough on a sample desk."
      >
        <MarketingCta to="/auth/register" className="px-7 py-3.5">
          Start a merchant trial
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </MarketingCta>
        <MarketingCta to="/demo" variant="glass" className="px-7 py-3.5">Request a demo</MarketingCta>
      </CtaBand>

      <div className="-mt-10 pb-12 text-center">
        <Link to="/pricing" className="text-sm font-medium text-emerald-700 hover:underline">
          Tenant plans
        </Link>
      </div>
    </div>
  );
}
