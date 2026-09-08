import {
  Shield, Building2, LayoutDashboard, Package, Barcode, GitCompare, Warehouse,
  ShoppingCart, Truck, Store, RotateCcw, FileSpreadsheet, CreditCard, Users, Bell, Settings,
} from 'lucide-react';
import { MarketingCta, IconWell, MktCard, OrderFlow, RoleGrid } from '../../components/marketing/MarketingCta';

const groups = [
  {
    title: 'SaaS & access',
    items: [
      { icon: Shield, tone: 'blue', accent: 'bg-blue-500', name: 'Authentication', text: 'JWT-ready session, password reset and API keys per merchant. Super Admin, Admin and Vendor stay in one tenant.' },
      { icon: Building2, tone: 'violet', accent: 'bg-violet-500', name: 'Tenant / merchant', text: 'One company, one wall. Shopify, Amazon and Myntra listings never mix with another brand.' },
      { icon: Users, tone: 'sky', accent: 'bg-sky-400', name: 'Users & roles', text: 'Merchant Super Admin, Operations, Warehouse, Accounts, Catalog, Support, Vendor. Screens check permission keys, not the job title.' },
      { icon: LayoutDashboard, tone: 'slate', accent: 'bg-slate-500', name: 'Dashboard', text: 'Four KPIs Leheriya uses: shipping, new orders, returns, pending invoices. Channel mix and top SKUs beside them.' },
    ],
  },
  {
    title: 'Catalog & stock',
    items: [
      { icon: Package, tone: 'amber', accent: 'bg-amber-400', name: 'Products', text: 'Catalog with variants. Channel listings hang off Master SKU, not a one-off Amazon title.' },
      { icon: Barcode, tone: 'orange', accent: 'bg-orange-400', name: 'Master SKU', text: 'One internal identity for every style. Marketplace SKUs map here so stock is not double-counted.' },
      { icon: GitCompare, tone: 'emerald', accent: 'bg-emerald-400', name: 'SKU mapping', text: 'Unmapped listings sit in a queue until ops ties them. No silent oversell.' },
      { icon: Warehouse, tone: 'rose', accent: 'bg-rose-400', name: 'Inventory & warehouses', text: 'WH-001 offline (all channels) and WH-002 virtual (Shopify). Ledger, not a single overwritten qty.' },
    ],
  },
  {
    title: 'Orders to cash',
    items: [
      { icon: ShoppingCart, tone: 'sky', accent: 'bg-sky-400', name: 'Orders & fulfilment', text: 'Relevant tabs only: Unfulfillable, New, Packed, Ready to ship, Cancelled, All. Vendor split when qty > 1.' },
      { icon: Truck, tone: 'blue', accent: 'bg-blue-500', name: 'Shipping', text: 'Labels, manifests, AWB. Cancel label reverts Shopify to unfulfilled.' },
      { icon: Store, tone: 'amber', accent: 'bg-amber-400', name: 'Vendors', text: 'Accept / reject, dispatch, bulk AWB. Same phone number can exist on more than one vendor.' },
      { icon: RotateCcw, tone: 'rose', accent: 'bg-rose-400', name: 'Returns · RTO · NDR', text: 'Three reverse paths, same pattern as forward orders. Restock destination is chosen at QC — not a ticket pile.' },
      { icon: FileSpreadsheet, tone: 'violet', accent: 'bg-violet-500', name: 'GST invoice', text: 'Sequential numbers. Shopify GST invoice number = Order ID.' },
      { icon: CreditCard, tone: 'emerald', accent: 'bg-emerald-400', name: 'Settlement matching', text: 'Amazon / Myntra payout files against Master Orders. Partially paid is treated as COD until money lands.' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { icon: Bell, tone: 'orange', accent: 'bg-orange-400', name: 'Notifications', text: 'Telegram, email, WhatsApp switches per Shopify / Amazon / Myntra event. Vendor Telegram on assign.' },
      { icon: Settings, tone: 'slate', accent: 'bg-slate-500', name: 'Channels & settings', text: 'Connect Amazon, Myntra, Shopify. Warehouse on the channel. Secrets stay off the Admin role.' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-sky-50 py-16 sm:py-20">
        <div className="pointer-events-none absolute -right-20 top-0 h-64 w-64 rounded-full bg-violet-300/30 blur-3xl animate-float" />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Features</h1>
          <p className="mt-4 text-lg text-slate-600">
            Twenty-three modules for one tenant. Launch channels: Shopify, Amazon, Myntra. Each card is a real Leheriya screen.
          </p>
        </div>
      </section>

      <section className="bg-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-blue-700">Daily path</p>
          <OrderFlow />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-blue-700">Who sees what</p>
          <RoleGrid />
        </div>
      </section>

      <section className="bg-gradient-to-b from-white to-slate-50 py-16">
        <div className="mx-auto max-w-6xl space-y-14 px-4 sm:px-6">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-blue-700">{group.title}</h2>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <MktCard key={item.name} accent={item.accent}>
                    <IconWell icon={item.icon} tone={item.tone} />
                    <h3 className="text-lg font-bold text-slate-900">{item.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                  </MktCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-700 py-16 text-white">
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto max-w-xl px-4 text-center">
          <h2 className="text-2xl font-bold">See Leheriya’s desk</h2>
          <p className="mt-2 text-blue-100">Orders, WH-001 / WH-002 and GST on a sample tenant — not a generic console tour.</p>
          <MarketingCta to="/contact" variant="outline" className="mt-6 border-white/50 bg-white text-blue-800 hover:border-white hover:text-blue-900">
            See Leheriya’s desk
          </MarketingCta>
        </div>
      </section>
    </div>
  );
}
