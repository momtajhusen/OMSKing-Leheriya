import { Link } from 'react-router-dom';
import {
  ShoppingCart, Warehouse, Truck, CreditCard, Radio, PackageCheck,
  Crown, Briefcase, Store, ShoppingBag, Shirt, Plug,
  ShoppingBasket, Tag, Sparkles, Gem, Boxes, Calculator, BellRing, PackagePlus,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Reveal, SpotlightCard } from './MktKit';

export function MarketingCta({ to, children, variant = 'solid', className, onClick }) {
  const styles =
    variant === 'solid'
      ? 'bg-gradient-to-r from-emerald-700 to-lime-600 text-white shadow-lg shadow-emerald-700/25 hover:from-emerald-800 hover:to-lime-700 hover:shadow-xl hover:shadow-emerald-700/30'
      : variant === 'ghost'
        ? 'text-slate-600 hover:text-emerald-700'
        : variant === 'glass'
          ? 'border border-white/25 bg-white/10 text-white backdrop-blur hover:border-white/50 hover:bg-white/20'
          : 'border border-slate-200 bg-white/80 text-slate-800 shadow-sm backdrop-blur hover:border-emerald-200 hover:text-emerald-700';

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'group inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-300 ease-premium hover:-translate-y-0.5 active:scale-[0.98]',
        variant === 'solid' && 'mkt-cta-solid',
        styles,
        className
      )}
    >
      {children}
    </Link>
  );
}

export function IconWell({ icon: Icon, tone = 'blue', className }) {
  const tones = {
    blue: 'from-emerald-500 to-teal-600 shadow-emerald-500/35',
    sky: 'from-sky-400 to-cyan-500 shadow-sky-500/35',
    amber: 'from-amber-400 to-orange-500 shadow-orange-500/35',
    emerald: 'from-emerald-400 to-teal-500 shadow-emerald-500/35',
    rose: 'from-rose-400 to-pink-500 shadow-pink-500/35',
    violet: 'from-violet-500 to-purple-500 shadow-violet-500/35',
    orange: 'from-orange-400 to-red-400 shadow-orange-500/35',
    slate: 'from-slate-500 to-slate-700 shadow-slate-500/35',
  };

  return (
    <div
      className={cn(
        'mkt-icon-well relative mb-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br text-white shadow-lg ring-4 ring-white icon-well transition-transform duration-300 ease-premium',
        tones[tone] || tones.blue,
        className
      )}
    >
      <Icon className="relative h-7 w-7 drop-shadow-sm" strokeWidth={1.8} />
    </div>
  );
}

export function MktCard({ children, className, accent, icon: Icon }) {
  return (
    <SpotlightCard accent={accent} className={className}>
      {Icon && <Icon className="mkt-card-watermark" strokeWidth={1.2} aria-hidden="true" />}
      {children}
    </SpotlightCard>
  );
}

export function ChannelPills() {
  const items = [
    { name: 'Shopify', meta: 'D2C store · Admin API', bar: 'from-emerald-400 to-emerald-600', icon: Store, well: 'from-emerald-400 to-teal-500' },
    { name: 'Amazon', meta: 'Marketplace · SP-API', bar: 'from-amber-400 to-orange-500', icon: ShoppingBag, well: 'from-amber-400 to-orange-500' },
    { name: 'Myntra', meta: 'Fashion · PPMP API', bar: 'from-pink-400 to-rose-500', icon: Shirt, well: 'from-pink-400 to-rose-500' },
    { name: 'Flipkart', meta: 'Marketplace · Seller API', bar: 'from-sky-400 to-blue-500', icon: ShoppingBasket, well: 'from-sky-400 to-blue-500' },
    { name: 'Meesho', meta: 'Social commerce · Supplier API', bar: 'from-fuchsia-400 to-purple-500', icon: Tag, well: 'from-fuchsia-400 to-purple-500' },
    { name: 'AJIO', meta: 'Fashion · Vendor API', bar: 'from-slate-500 to-slate-800', icon: Sparkles, well: 'from-slate-500 to-slate-800' },
    { name: 'Nykaa', meta: 'Beauty & fashion · Partner API', bar: 'from-rose-400 to-pink-600', icon: Gem, well: 'from-rose-400 to-pink-600' },
    { name: 'Your channel', meta: 'Partner API connector', bar: 'from-lime-400 to-emerald-500', icon: Plug, well: 'from-lime-400 to-emerald-500' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, index) => (
        <Reveal key={item.name} delay={index * 60}>
          <SpotlightCard className="rounded-2xl p-0">
            <div className={cn('h-1.5 bg-gradient-to-r', item.bar)} />
            <div className="flex items-center gap-3 px-4 py-4">
              <span className={cn('icon-well flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-300', item.well)}>
                <item.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{item.name}</p>
                <p className="text-xs leading-4 text-slate-500">{item.meta}</p>
              </div>
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-400 opacity-0 shadow-[0_0_0_4px_rgba(16,185,129,0.15)] transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          </SpotlightCard>
        </Reveal>
      ))}
    </div>
  );
}

export function OpsPreview() {
  const kpis = [
    { label: 'New', value: '24', tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'Ship', value: '11', tone: 'bg-sky-50 text-sky-700' },
    { label: 'Returns', value: '3', tone: 'bg-rose-50 text-rose-700' },
    { label: 'Invoices', value: '8', tone: 'bg-violet-50 text-violet-700' },
  ];
  const bars = [42, 70, 55, 92, 64, 80, 48, 76];
  const mix = [
    { name: 'Shopify', width: '46%', tone: 'bg-emerald-500' },
    { name: 'Amazon', width: '22%', tone: 'bg-amber-500' },
    { name: 'Myntra', width: '14%', tone: 'bg-pink-500' },
    { name: 'Flipkart', width: '10%', tone: 'bg-sky-500' },
    { name: 'Others', width: '8%', tone: 'bg-slate-400' },
  ];

  return (
    <div className="relative px-2 py-6 sm:px-6">
      <div className="absolute inset-4 rounded-[2rem] bg-gradient-to-br from-emerald-400/30 via-lime-300/20 to-teal-300/30 blur-2xl animate-pulse-soft" />
      <div className="relative rounded-[1.6rem] border border-white/70 bg-white/95 p-5 text-slate-900 shadow-2xl backdrop-blur transition duration-500 hover:-translate-y-1">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <div className="ml-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Today</p>
              <p className="text-sm font-bold text-slate-900">Order desk</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
            Synced 2 min ago
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {kpis.map((kpi) => (
            <div key={kpi.label} className={cn('min-w-0 rounded-xl px-2.5 py-3 transition duration-300 hover:scale-[1.04]', kpi.tone)}>
              <p className="text-[11px] font-medium opacity-80">{kpi.label}</p>
              <p className="text-xl font-bold leading-none sm:text-2xl">{kpi.value}</p>
            </div>
          ))}
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Orders · 7 days</p>
        <div className="flex h-20 items-end gap-1.5">
          {bars.map((height, index) => (
            <div
              key={index}
              className="origin-bottom flex-1 rounded-t-md bg-gradient-to-t from-emerald-700 to-lime-400 animate-bar-rise"
              style={{ height: `${height}%`, animationDelay: `${300 + index * 70}ms` }}
            />
          ))}
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Channel mix</p>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          {mix.map((item) => (
            <span key={item.name} className={cn('h-full', item.tone)} style={{ width: item.width }} title={item.name} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {mix.map((item) => (
            <span key={item.name} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
              <span className={cn('h-1.5 w-1.5 rounded-full', item.tone)} />
              {item.name}
            </span>
          ))}
        </div>
      </div>

      <div className="mkt-float absolute -left-2 top-2 hidden items-center gap-3 rounded-2xl border border-white/70 bg-white/95 px-3.5 py-2.5 text-slate-900 shadow-xl backdrop-blur sm:flex">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
          <BellRing className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold text-slate-400">New order · Shopify</p>
          <p className="text-sm font-bold">68798-LEH</p>
        </div>
      </div>
      <div className="mkt-float mkt-float-delay absolute -right-2 bottom-0 hidden items-center gap-3 rounded-2xl border border-white/70 bg-white/95 px-3.5 py-2.5 text-slate-900 shadow-xl backdrop-blur sm:flex">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
          <PackagePlus className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[11px] font-semibold text-slate-400">Reserved · WH-001</p>
          <p className="text-sm font-bold">2 units, offline</p>
        </div>
      </div>
    </div>
  );
}

export function OrderFlow() {
  const steps = [
    { icon: Radio, label: 'Channel', hint: '7 channels + partner API, synced every 15 min', tone: 'from-pink-500 to-rose-500' },
    { icon: ShoppingCart, label: 'Master order', hint: 'One ID, split if qty > 1', tone: 'from-teal-500 to-emerald-600' },
    { icon: Warehouse, label: 'Stock', hint: 'Offline first, else vendor / virtual', tone: 'from-amber-400 to-orange-500' },
    { icon: PackageCheck, label: 'Pack', hint: 'New → Packed → RTS', tone: 'from-violet-500 to-purple-500' },
    { icon: Truck, label: 'Ship', hint: 'Delhivery AWB · manifest · tracking', tone: 'from-emerald-400 to-teal-500' },
    { icon: CreditCard, label: 'Settle', hint: 'GST invoice · payout match', tone: 'from-emerald-700 to-lime-600' },
  ];

  return (
    <div className="relative">
      <div className="mkt-flow-line absolute left-[8%] right-[8%] top-[44px] hidden h-0.5 lg:block" aria-hidden="true" />
      <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map((step, index) => (
          <Reveal as="li" key={step.label} delay={index * 90} className="relative">
            <div className="group h-full rounded-3xl border border-slate-200/70 bg-white p-5 text-center shadow-[0_14px_34px_-20px_rgba(15,23,42,0.25)] transition duration-300 ease-premium hover:-translate-y-1.5 hover:border-emerald-200 hover:shadow-[0_28px_50px_-24px_rgba(13,92,69,0.35)]">
              <span className={cn('relative mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ring-4 ring-white transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110', step.tone)}>
                <step.icon className="h-6 w-6" />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white ring-2 ring-white">
                  {index + 1}
                </span>
              </span>
              <p className="text-sm font-bold text-slate-900">{step.label}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-500">{step.hint}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

export function RoleGrid() {
  const roles = [
    { icon: Crown, tone: 'blue', title: 'Super Admin', text: 'One merchant — e.g. Leheriya. Users, channels, GST, warehouses. Stays inside this company only.' },
    { icon: Briefcase, tone: 'sky', title: 'Operations', text: 'Pack, ship, assign vendors. Permissions like orders.edit — not the role title — decide what they can do.' },
    { icon: Boxes, tone: 'emerald', title: 'Warehouse', text: 'Stock in, adjustments, packing and returns QC. Every move lands on the ledger.' },
    { icon: Calculator, tone: 'violet', title: 'Accounts', text: 'GST invoices, credit notes, COD and marketplace payout matching.' },
    { icon: Store, tone: 'amber', title: 'Vendor', text: 'Own assigned lines only: accept, dispatch, AWB. Same phone may exist on another vendor.' },
  ];

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
      {roles.map((role, index) => (
        <Reveal key={role.title} delay={index * 80}>
          <MktCard>
            <IconWell icon={role.icon} tone={role.tone} />
            <h3 className="text-base font-bold text-slate-900">{role.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{role.text}</p>
          </MktCard>
        </Reveal>
      ))}
    </div>
  );
}
