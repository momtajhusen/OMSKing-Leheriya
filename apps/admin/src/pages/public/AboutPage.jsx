import { Warehouse, Shield, Scale, Handshake, Crown, Store } from 'lucide-react';
import { IconWell, MarketingCta, MktCard, RoleGrid } from '../../components/marketing/MarketingCta';

const values = [
  { icon: Warehouse, tone: 'amber', title: 'Ops first', text: 'Screens match Leheriya’s packing table, WH-001 / WH-002 and GST files — not a generic SaaS template.' },
  { icon: Shield, tone: 'blue', title: 'Tenant walls', text: 'A merchant Super Admin stays inside their own brand. Another company’s orders never appear.' },
  { icon: Scale, tone: 'violet', title: 'India rules we actually coded', text: 'Shopify GST invoice = Order ID. Partially paid = COD. Same phone allowed on more than one vendor.' },
  { icon: Handshake, tone: 'emerald', title: 'Vendor honest', text: 'Vendors get assigned Master Order rows only. No other vendor’s rates, no finance tabs.' },
];

export default function AboutPage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-sky-50 py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">About OMSKing</h1>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              OMSKing started as Leheriya Creations’ operations system — Jaipur fashion on Shopify, Amazon and Myntra, with Master SKU and two warehouses. That tenant is now the product every subscriber gets.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <MktCard className="text-center">
              <IconWell icon={Store} tone="amber" className="mx-auto" />
              <p className="text-sm font-bold">First tenant</p>
              <p className="text-xs text-slate-500">Leheriya Creations</p>
            </MktCard>
            <MktCard className="text-center">
              <IconWell icon={Crown} tone="violet" className="mx-auto" />
              <p className="text-sm font-bold">Merchant login</p>
              <p className="text-xs text-slate-500">Super Admin · Operations · Vendor</p>
            </MktCard>
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-8 text-center text-2xl font-bold text-slate-900">Who logs in</h2>
          <RoleGrid />
        </div>
      </section>

      <section className="bg-gradient-to-b from-slate-50 to-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold text-slate-900">How we work</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((item) => (
              <MktCard key={item.title}>
                <IconWell icon={item.icon} tone={item.tone} />
                <h3 className="font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
              </MktCard>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold text-slate-900">Timeline</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <MktCard accent="bg-blue-500">
              <p className="text-sm font-semibold text-blue-700">Now</p>
              <p className="mt-1 font-bold text-slate-900">Leheriya as first tenant</p>
              <p className="mt-2 text-sm text-slate-600">Clickable UI for every module. Super Admin, Admin and Vendor inside one tenant.</p>
            </MktCard>
            <MktCard accent="bg-violet-500">
              <p className="text-sm font-semibold text-violet-700">Next</p>
              <p className="mt-1 font-bold text-slate-900">Live JWT + inventory ledger</p>
              <p className="mt-2 text-sm text-slate-600">Tenant middleware, then catalog and the stock engine that makes omnichannel safe.</p>
            </MktCard>
          </div>
          <MarketingCta to="/contact" className="mt-10">Work with us</MarketingCta>
        </div>
      </section>
    </div>
  );
}
