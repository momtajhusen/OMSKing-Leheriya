import { Link } from 'react-router-dom';
import {
  ShoppingCart, Warehouse, Truck, CreditCard, Radio, PackageCheck,
  Crown, Briefcase, Store, ChevronRight, ShoppingBag, Shirt, Plus,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export function MarketingCta({ to, children, variant = 'solid', className, onClick }) {
  const styles =
    variant === 'solid'
      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25 hover:from-blue-700 hover:to-indigo-700'
      : variant === 'ghost'
        ? 'text-slate-600 hover:text-blue-700'
        : 'border border-slate-200 bg-white/80 text-slate-800 shadow-sm backdrop-blur hover:border-blue-200 hover:text-blue-700';

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
    blue: 'from-blue-500 to-indigo-500',
    sky: 'from-sky-400 to-cyan-500',
    amber: 'from-amber-400 to-orange-500',
    emerald: 'from-emerald-400 to-teal-500',
    rose: 'from-rose-400 to-pink-500',
    violet: 'from-violet-500 to-purple-500',
    orange: 'from-orange-400 to-red-400',
    slate: 'from-slate-500 to-slate-700',
  };

  return (
    <div
      className={cn(
        'mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg icon-well transition-transform duration-300 ease-premium',
        tones[tone] || tones.blue,
        className
      )}
    >
      <Icon className="h-7 w-7" strokeWidth={1.8} />
    </div>
  );
}

export function MktCard({ children, className, accent }) {
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white bg-white p-6 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.18)] transition duration-300 ease-premium hover:-translate-y-1 hover:shadow-[0_24px_50px_-18px_rgba(37,99,235,0.28)]',
        className
      )}
    >
      {accent && <span className={cn('absolute inset-x-0 top-0 h-1', accent)} />}
      {children}
    </article>
  );
}

export function ChannelPills() {
  const items = [
    { name: 'Shopify', meta: 'Storefront', bar: 'from-emerald-400 to-emerald-600', icon: Store, well: 'from-emerald-400 to-teal-500' },
    { name: 'Amazon', meta: 'Seller / SP-API', bar: 'from-amber-400 to-orange-500', icon: ShoppingBag, well: 'from-amber-400 to-orange-500' },
    { name: 'Myntra', meta: 'Partner API', bar: 'from-pink-400 to-rose-500', icon: Shirt, well: 'from-pink-400 to-rose-500' },
    { name: 'Not at launch', meta: 'Added per tenant', bar: 'from-slate-300 to-slate-500', icon: Plus, well: 'from-slate-400 to-slate-600' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.name}
          className="group overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.15)] ring-1 ring-slate-100 transition duration-300 ease-premium hover:-translate-y-1 hover:shadow-lg"
        >
          <div className={cn('h-1.5 bg-gradient-to-r', item.bar)} />
          <div className="flex items-center gap-3 px-4 py-4">
            <span className={cn('icon-well flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 group-hover:scale-110', item.well)}>
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="font-bold text-slate-900">{item.name}</p>
              <p className="text-xs text-slate-500">{item.meta}</p>
            </div>
          </div>
        </div>
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

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-blue-400/20 via-fuchsia-300/20 to-amber-300/30 blur-2xl animate-pulse-soft" />
      <div className="relative rounded-[1.6rem] border border-white/80 bg-white/90 p-5 shadow-2xl backdrop-blur transition duration-500 hover:-translate-y-1 hover:shadow-[0_28px_60px_-20px_rgba(37,99,235,0.35)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Today</p>
            <p className="text-sm font-bold text-slate-900">Leheriya Creations</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
            Tenant live
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {kpis.map((kpi) => (
            <div key={kpi.label} className={cn('rounded-xl px-3 py-3 transition duration-300 hover:scale-[1.03]', kpi.tone)}>
              <p className="text-[11px] font-medium opacity-80">{kpi.label}</p>
              <p className="text-2xl font-bold leading-none">{kpi.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Orders · 7 days</p>
        <div className="flex h-24 items-end gap-1.5">
          {bars.map((height, index) => (
            <div
              key={index}
              className="origin-bottom flex-1 rounded-t-md bg-gradient-to-t from-blue-600 to-sky-400 animate-bar-rise"
              style={{ height: `${height}%`, animationDelay: `${index * 60}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrderFlow() {
  const steps = [
    { icon: Radio, label: 'Channel', hint: 'Shopify · Amazon · Myntra', tone: 'from-pink-500 to-rose-500' },
    { icon: ShoppingCart, label: 'Master order', hint: 'One ID, split if qty > 1', tone: 'from-sky-500 to-blue-600' },
    { icon: Warehouse, label: 'Stock', hint: 'WH-001 / WH-002', tone: 'from-amber-400 to-orange-500' },
    { icon: PackageCheck, label: 'Pack', hint: 'New → Packed → RTS', tone: 'from-violet-500 to-purple-500' },
    { icon: Truck, label: 'Ship', hint: 'AWB · label cancel', tone: 'from-emerald-400 to-teal-500' },
    { icon: CreditCard, label: 'Settle', hint: 'GST ID = Order ID', tone: 'from-blue-600 to-indigo-600' },
  ];

  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2">
      {steps.map((step, index) => (
        <div key={step.label} className="flex items-center gap-2">
          <div className="w-[148px] rounded-2xl bg-white p-4 text-center shadow-[0_12px_32px_-14px_rgba(15,23,42,0.2)] ring-1 ring-slate-100 transition duration-300 ease-premium hover:-translate-y-1 hover:shadow-lg">
            <span className={cn('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 hover:scale-110', step.tone)}>
              <step.icon className="h-6 w-6" />
            </span>
            <p className="text-sm font-bold text-slate-900">{step.label}</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">{step.hint}</p>
          </div>
          {index < steps.length - 1 && (
            <ChevronRight className="hidden h-5 w-5 shrink-0 text-slate-300 transition-transform duration-300 lg:block" />
          )}
        </div>
      ))}
    </div>
  );
}

export function RoleGrid() {
  const roles = [
    { icon: Crown, tone: 'blue', title: 'Super Admin', text: 'One merchant — e.g. Leheriya. Users, channels, GST, warehouses. Stays inside this company only.' },
    { icon: Briefcase, tone: 'sky', title: 'Operations', text: 'Pack, ship, vendors. Permissions like orders.edit — not the role title — decide what they can do.' },
    { icon: Store, tone: 'amber', title: 'Vendor', text: 'Assigned Master Order rows only. Same phone may exist on another vendor.' },
  ];

  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {roles.map((role) => (
        <MktCard key={role.title}>
          <IconWell icon={role.icon} tone={role.tone} />
          <h3 className="text-base font-bold text-slate-900">{role.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{role.text}</p>
        </MktCard>
      ))}
    </div>
  );
}
