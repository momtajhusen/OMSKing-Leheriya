import {
  Shield, Building2, LayoutDashboard, Package, Barcode, GitCompare, Warehouse,
  ShoppingCart, Truck, Store, RotateCcw, FileSpreadsheet, CreditCard, Users, Bell, Settings,
  Radio, Plug, Webhook, KeyRound, ScrollText, BarChart3, Upload, Rocket, ArrowRight, Workflow, Layers,
} from 'lucide-react';
import { MarketingCta, IconWell, MktCard, OrderFlow, RoleGrid, ChannelPills } from '../../components/marketing/MarketingCta';
import { PageHero, SectionHeading, Reveal, CtaBand } from '../../components/marketing/MktKit';
import MktImage from '../../components/marketing/MktImage';

const slug = (title) => title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');

const groups = [
  {
    title: 'Channels & sync',
    image: 'features-group-channels',
    items: [
      { icon: Radio, tone: 'rose', accent: 'bg-rose-400', name: 'Native channels', text: 'Shopify (Admin API), Amazon (SP-API) and Myntra (PPMP API). Orders, listings, returns and stock on each connection.' },
      { icon: Plug, tone: 'sky', accent: 'bg-sky-400', name: 'Marketplace connectors', text: 'Flipkart, Meesho, AJIO and Nykaa through a seller API connector: API host and token per merchant, orders, listings and stock.' },
      { icon: Rocket, tone: 'emerald', accent: 'bg-emerald-400', name: 'Auto sync', text: 'Every 15 minutes each connection pulls orders, products and returns. Jobs retry on failure and keep a heartbeat.' },
    ],
  },
  {
    title: 'SaaS & access',
    image: 'features-group-access',
    items: [
      { icon: Shield, tone: 'blue', accent: 'bg-emerald-500', name: 'Authentication', text: 'JWT sessions, password reset and API keys per merchant. Super Admin, Operations and Vendor stay in one tenant.' },
      { icon: Building2, tone: 'violet', accent: 'bg-violet-500', name: 'Tenant / merchant', text: 'One company, one wall. Every query is scoped to the signed-in merchant — listings never mix with another brand.' },
      { icon: Users, tone: 'sky', accent: 'bg-sky-400', name: 'Users & roles', text: 'Merchant Super Admin, Operations, Warehouse, Accounts, Catalog, Support, Vendor. Screens check permission keys, not the job title.' },
      { icon: LayoutDashboard, tone: 'slate', accent: 'bg-slate-500', name: 'Dashboard', text: 'Four KPIs Leheriya uses: shipping, new orders, returns, pending invoices. Channel mix and top SKUs beside them.' },
      { icon: ScrollText, tone: 'orange', accent: 'bg-orange-400', name: 'Audit logs', text: 'Who changed what, and when — orders, catalog, vendors, channels, warehouses, settings and users.' },
    ],
  },
  {
    title: 'Catalog & stock',
    image: 'features-group-stock',
    items: [
      { icon: Package, tone: 'amber', accent: 'bg-amber-400', name: 'Products', text: 'Catalog with variants and product import. Channel listings hang off Master SKU, not a one-off marketplace title.' },
      { icon: Barcode, tone: 'orange', accent: 'bg-orange-400', name: 'Master SKU', text: 'One internal identity for every style. Marketplace SKUs map here, and a new Shopify SKU creates its master on the first order.' },
      { icon: GitCompare, tone: 'emerald', accent: 'bg-emerald-400', name: 'SKU mapping', text: 'Unmapped listings sit in a queue until ops ties them. No silent oversell.' },
      { icon: Warehouse, tone: 'rose', accent: 'bg-rose-400', name: 'Inventory & warehouses', text: 'WH-001 offline (every channel) and WH-002 virtual (Shopify). Reservations, ledger and low-stock alerts.' },
      { icon: Upload, tone: 'sky', accent: 'bg-sky-400', name: 'Opening stock import', text: 'Opening stock from your Shopify locations in one background job. Rows that already have stock are left alone.' },
    ],
  },
  {
    title: 'Orders to cash',
    image: 'features-group-orders',
    items: [
      { icon: ShoppingCart, tone: 'sky', accent: 'bg-sky-400', name: 'Orders & fulfilment', text: 'Relevant tabs only: Unfulfillable, New, Packed, Ready to ship, Cancelled, All. Offline stock first, else vendor; split when qty > 1.' },
      { icon: Truck, tone: 'blue', accent: 'bg-emerald-500', name: 'Shipping', text: 'Delhivery AWB, labels, manifests, scheduled pickups and tracking. Cancel label reverts Shopify to unfulfilled.' },
      { icon: Store, tone: 'amber', accent: 'bg-amber-400', name: 'Vendors', text: 'Assign a vendor per item from the order. Accept / reject, dispatch, bulk AWB. Same phone number can exist on more than one vendor.' },
      { icon: RotateCcw, tone: 'rose', accent: 'bg-rose-400', name: 'Returns · RTO · NDR', text: 'Three reverse paths, same pattern as forward orders. Restock destination is chosen at QC — not a ticket pile.' },
      { icon: FileSpreadsheet, tone: 'violet', accent: 'bg-violet-500', name: 'GST invoice', text: 'Gapless numbers, HSN rates, CGST/SGST or IGST from the ship-to state, credit notes and PDF invoices.' },
      { icon: CreditCard, tone: 'emerald', accent: 'bg-emerald-400', name: 'Settlement matching', text: 'Marketplace payout files against Master Orders. Partially paid is treated as COD until money lands.' },
      { icon: BarChart3, tone: 'slate', accent: 'bg-slate-500', name: 'Reports', text: 'Sales, inventory, shipping, cancellations, reconciliation and vendor reports in one screen.' },
    ],
  },
  {
    title: 'Setup & integrations',
    image: 'features-group-setup',
    items: [
      { icon: Bell, tone: 'orange', accent: 'bg-orange-400', name: 'Notifications', text: 'Email, WhatsApp, Telegram and in-app switches per channel event. Vendors get a ping on assign.' },
      { icon: Settings, tone: 'slate', accent: 'bg-slate-500', name: 'Channels & settings', text: 'Connect any of the seven channels, pick the warehouse per channel. Secrets stay off the Admin role.' },
      { icon: Webhook, tone: 'violet', accent: 'bg-violet-500', name: 'Webhooks', text: 'Signed channel webhooks with an event log and one-click retry.' },
      { icon: KeyRound, tone: 'blue', accent: 'bg-emerald-500', name: 'API keys', text: 'Per-merchant keys for your own tools. Create and revoke from settings.' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div>
      <PageHero
        eyebrow="Features"
        icon={Layers}
        title="Everything a multichannel seller needs,"
        highlight="on one desk."
        text="A multichannel OMS for one tenant: seven sales channels, Master SKU stock, vendors, Delhivery shipping and GST. Each card is a real screen Leheriya uses."
      >
        <div className="flex flex-wrap justify-center gap-3">
          {groups.map((group) => (
            <a
              key={group.title}
              href={`#${slug(group.title)}`}
              className="group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/20"
            >
              {group.title}
              <span className="rounded-full bg-lime-300/25 px-2 py-0.5 text-[11px] text-lime-100">{group.items.length}</span>
            </a>
          ))}
        </div>
      </PageHero>

      <section className="relative z-10 -mt-16 bg-transparent px-4 sm:-mt-20 sm:px-6">
        <Reveal className="relative mx-auto max-w-5xl">
          <div className="pointer-events-none absolute -inset-6 rounded-[3rem] bg-gradient-to-r from-emerald-300/40 via-lime-200/40 to-teal-300/40 blur-3xl" />
          <div className="relative rounded-[2rem] border border-white/70 bg-white/80 p-2 shadow-[0_50px_100px_-50px_rgba(13,92,69,0.6)] backdrop-blur sm:p-3">
            <MktImage name="features-dashboard-showcase" priority className="rounded-[1.5rem]" />
          </div>
        </Reveal>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Channels" icon={Radio} title="Seven channels," highlight="one Master Order" />
          <ChannelPills />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Daily path" icon={Workflow} title="From channel to" highlight="settled payout" />
          <OrderFlow />
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Who sees what" icon={Users} title="Permissions decide," highlight="not job titles" />
          <RoleGrid />
        </div>
      </section>

      <section className="bg-gradient-to-b from-white to-slate-50 py-20">
        <div className="mx-auto max-w-6xl space-y-20 px-4 sm:px-6">
          {groups.map((group, groupIndex) => (
            <div key={group.title} id={slug(group.title)} className="scroll-mt-28">
              <Reveal className="mb-8 flex items-end justify-between gap-4 border-b border-slate-200 pb-5">
                <div className="flex items-center gap-4">
                  <span className="text-4xl font-black text-emerald-100 sm:text-5xl">0{groupIndex + 1}</span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Module group</p>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{group.title}</h2>
                  </div>
                </div>
                <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 sm:inline-flex">
                  {group.items.length} modules
                </span>
              </Reveal>
              <Reveal className="mb-8">
                <MktImage name={group.image} aspectClassName="aspect-[3/2] sm:aspect-[3/1]" className="shadow-[0_30px_60px_-35px_rgba(13,92,69,0.45)]" />
              </Reveal>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item, index) => (
                  <Reveal key={item.name} delay={(index % 3) * 80}>
                    <MktCard accent={item.accent} icon={item.icon}>
                      <IconWell icon={item.icon} tone={item.tone} />
                      <h3 className="text-lg font-bold text-slate-900">{item.name}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                    </MktCard>
                  </Reveal>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <CtaBand
        eyebrow="Walkthrough"
        title="See it on"
        highlight="a sample desk"
        text="Your channels, WH-001 / WH-002, vendors and GST. The demo form does not create a login."
      >
        <MarketingCta to="/demo" className="px-7 py-3.5">
          Request a demo
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </MarketingCta>
        <MarketingCta to="/pricing" variant="glass" className="px-7 py-3.5">See pricing</MarketingCta>
      </CtaBand>
    </div>
  );
}
