import { Link } from 'react-router-dom';
import {
  ShoppingCart, Warehouse, Truck, RotateCcw, FileSpreadsheet, CreditCard,
  Check, ArrowRight, Layers, Barcode, Store, Handshake, Building2, Users,
} from 'lucide-react';
import { MarketingCta, IconWell, MktCard, ChannelPills, OpsPreview, OrderFlow, RoleGrid } from '../../components/marketing/MarketingCta';

const pillars = [
  {
    icon: Layers,
    tone: 'sky',
    accent: 'bg-gradient-to-r from-teal-400 to-emerald-600',
    title: 'One Master Order',
    text: 'Shopify, Amazon and Myntra sync into a single Leheriya order. If qty is more than 1, that row can split across vendors.',
  },
  {
    icon: Barcode,
    tone: 'amber',
    accent: 'bg-gradient-to-r from-amber-400 to-orange-400',
    title: 'Stock counted once',
    text: 'Listings map to a Master SKU. WH-001 (offline, all three channels) and WH-002 (virtual, Shopify only) keep a ledger — not one overwritten qty.',
  },
  {
    icon: FileSpreadsheet,
    tone: 'violet',
    accent: 'bg-gradient-to-r from-lime-400 to-emerald-500',
    title: 'GST on the Order ID',
    text: 'Shopify GST invoice number is the Order ID. Amazon and Myntra payout files match Master Orders. Partially paid stays COD until money lands.',
  },
];

const modules = [
  { icon: ShoppingCart, tone: 'sky', accent: 'bg-sky-400', title: 'Orders & fulfilment', text: 'Tabs that packing uses: Unfulfillable, New, Packed, Ready to ship, Cancelled, All. Sync, dispatch and labels on the same row.' },
  { icon: Warehouse, tone: 'amber', accent: 'bg-amber-400', title: 'Inventory & warehouses', text: 'WH-001 for walk-in and all channels. WH-002 for Shopify virtual stock. Reservations sit on a ledger.' },
  { icon: Truck, tone: 'emerald', accent: 'bg-emerald-400', title: 'Shipping', text: 'AWB, manifests, bulk tracking. Cancel a label and Shopify goes back to unfulfilled.' },
  { icon: RotateCcw, tone: 'rose', accent: 'bg-rose-400', title: 'Returns, RTO & NDR', text: 'Three reverse paths, same pattern as forward orders. Restock destination is chosen at QC.' },
  { icon: FileSpreadsheet, tone: 'violet', accent: 'bg-violet-400', title: 'GST invoicing', text: 'Gapless numbers. On Shopify the GST invoice number is the Order ID accounts already know.' },
  { icon: CreditCard, tone: 'blue', accent: 'bg-emerald-500', title: 'Settlement matching', text: 'Upload Amazon / Myntra settlement files against Master Orders. Short payouts stay visible until closed.' },
];

const checks = [
  'Same phone number is allowed on more than one vendor.',
  'Qty > 1 can split to different vendors on the same Master Order.',
  'Cancel a shipping label and Shopify returns to unfulfilled.',
];

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-lime-50 py-16 sm:py-24">
        <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-emerald-400/25 blur-3xl animate-float" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-lime-300/25 blur-3xl animate-float-slow" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700 shadow-sm ring-1 ring-emerald-100">
              First tenant · Leheriya Creations
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.12] tracking-tight text-slate-900 sm:text-5xl">
              Shopify, Amazon and Myntra become{' '}
              <span className="bg-gradient-to-r from-emerald-700 to-lime-500 bg-clip-text text-transparent">one Master Order</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 sm:text-lg">
              OMSKing is Leheriya’s packing desk as SaaS. Master SKU, two warehouses, GST on the Order ID — each merchant is a locked tenant.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <MarketingCta to="/contact" className="px-7 py-3">
                See Leheriya’s desk
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </MarketingCta>
              <MarketingCta to="/features" variant="outline" className="px-7 py-3">
                23 modules
              </MarketingCta>
            </div>
          </div>
          <OpsPreview />
        </div>
      </section>

      <section className="relative -mt-6 pb-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <ChannelPills />
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-slate-900">How a Leheriya order moves</h2>
            <p className="mt-2 text-slate-600">Channel in → Master Order → WH-001 / WH-002 → pack → ship. Sidebar stays short on purpose.</p>
          </div>
          <OrderFlow />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-slate-900">Who logs in</h2>
            <p className="mt-2 text-slate-600">Super Admin, Admin and Vendor — all inside one merchant, like Leheriya.</p>
          </div>
          <RoleGrid />
        </div>
      </section>

      <section id="why" className="scroll-mt-24 bg-gradient-to-b from-white to-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900">Built around Leheriya’s packing table</h2>
            <p className="mt-3 text-slate-600">
              Jaipur fashion, three launch channels, two warehouses. The same tenant model is what the next subscriber gets.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map((item) => (
              <MktCard key={item.title} accent={item.accent}>
                <IconWell icon={item.icon} tone={item.tone} />
                <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
              </MktCard>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-slate-900">Screens the team opens every day</h2>
            <p className="mt-3 text-slate-600">Orders first. Stock, reverse flow and GST behind them — not a 40-item tree.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((item) => (
              <MktCard key={item.title} accent={item.accent}>
                <IconWell icon={item.icon} tone={item.tone} />
                <h3 className="text-lg font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
              </MktCard>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-slate-900">
              Vendors, Shopify store, two warehouses —{' '}
              <span className="text-emerald-700">still one tenant</span>
            </h2>
            <ul className="mt-6 space-y-4">
              {checks.map((line) => (
                <li key={line} className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-100">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Handshake, label: 'Vendors', color: 'from-rose-500 to-pink-500' },
              { icon: Store, label: 'Shopify store', color: 'from-emerald-500 to-teal-500' },
              { icon: Building2, label: 'WH-001 · WH-002', color: 'from-amber-400 to-orange-500' },
              { icon: Users, label: 'Amazon · Myntra', color: 'from-emerald-500 to-teal-500' },
            ].map((node) => (
              <div
                key={node.label}
                className="flex flex-col items-center gap-3 rounded-2xl bg-white py-8 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.18)] ring-1 ring-slate-100 transition duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <span className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${node.color}`}>
                  <node.icon className="h-7 w-7" />
                </span>
                <span className="text-sm font-semibold text-slate-800">{node.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-gradient-to-r from-emerald-900 via-emerald-700 to-teal-600 py-16 text-white">
        <div className="pointer-events-none absolute right-0 top-0 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold">Leheriya is tenant one. The next brand gets the same walls.</h2>
          <p className="mt-3 text-emerald-100">
            Ops inside a tenant never sees another merchant’s orders. The next brand gets the same walls.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {['Shopify · Amazon · Myntra', 'WH-001 · WH-002', 'Super Admin · Operations · Vendor'].map((chip) => (
              <span key={chip} className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur">
                {chip}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-b from-white to-emerald-50 py-16">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold text-slate-900">Open the Leheriya tenant</h2>
          <p className="mt-3 text-slate-600">Start your own merchant trial, or walk the dummy desk we already built for Leheriya.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <MarketingCta to="/auth/register">Start a merchant trial</MarketingCta>
            <MarketingCta to="/contact" variant="outline">Talk to us</MarketingCta>
          </div>
          <Link to="/pricing" className="mt-4 text-sm font-medium text-emerald-700 hover:underline">
            Tenant plans
          </Link>
        </div>
      </section>
    </div>
  );
}
