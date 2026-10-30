import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function useInView(ref) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function Reveal({ as: Tag = 'div', delay = 0, className, style, children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return (
    <Tag
      ref={ref}
      className={cn('reveal', inView && 'is-visible', className)}
      style={{ ...style, '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Eyebrow({ icon: Icon, children, dark = false, className }) {
  return (
    <span className={cn('mkt-eyebrow', dark && 'mkt-eyebrow-dark', className)}>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="mkt-eyebrow-dot" />}
      {children}
    </span>
  );
}

export function SectionHeading({ eyebrow, icon, title, highlight, text, align = 'center', dark = false, className }) {
  return (
    <Reveal className={cn('mb-12 max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && <Eyebrow icon={icon} dark={dark}>{eyebrow}</Eyebrow>}
      <h2 className={cn('mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]', dark ? 'text-white' : 'text-slate-900')}>
        {title}
        {highlight && (
          <>
            {' '}
            <span className={cn('sm:block', dark ? 'mkt-gradient-text-light' : 'mkt-gradient-text')}>{highlight}</span>
          </>
        )}
      </h2>
      {text && (
        <p className={cn('mt-4 text-base leading-7 sm:text-lg', dark ? 'text-emerald-50/80' : 'text-slate-600')}>{text}</p>
      )}
    </Reveal>
  );
}

export function HeroBackdrop() {
  return (
    <>
      <div className="mkt-hero-mesh" aria-hidden="true" />
      <div className="mkt-grid-bg" aria-hidden="true" />
      <div className="mkt-orb mkt-orb-a" aria-hidden="true" />
      <div className="mkt-orb mkt-orb-b" aria-hidden="true" />
      <div className="mkt-hero-fade" aria-hidden="true" />
    </>
  );
}

export function PageHero({ eyebrow, icon, title, highlight, text, children, aside, compact = false }) {
  return (
    <section className="mkt-hero relative isolate overflow-hidden">
      <HeroBackdrop />
      <div
        className={cn(
          'relative mx-auto max-w-6xl px-4 sm:px-6',
          compact ? 'pb-20 pt-14 sm:pb-24 sm:pt-16' : 'pb-24 pt-16 sm:pb-32 sm:pt-24',
          aside ? 'grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]' : 'text-center'
        )}
      >
        <div className={aside ? '' : 'mx-auto max-w-3xl'}>
          {eyebrow && (
            <div className="mkt-rise">
              <Eyebrow icon={icon} dark>{eyebrow}</Eyebrow>
            </div>
          )}
          <h1
            className="mkt-rise mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl"
            style={{ '--rise-delay': '80ms' }}
          >
            {title}
            {highlight && (
              <>
                {' '}
                <span className="mkt-gradient-text-light">{highlight}</span>
              </>
            )}
          </h1>
          {text && (
            <p
              className={cn('mkt-rise mt-5 text-base leading-7 text-emerald-50/85 sm:text-lg', !aside && 'mx-auto max-w-2xl')}
              style={{ '--rise-delay': '160ms' }}
            >
              {text}
            </p>
          )}
          {children && (
            <div className="mkt-rise mt-8" style={{ '--rise-delay': '240ms' }}>
              {children}
            </div>
          )}
        </div>
        {aside && (
          <div className="mkt-rise" style={{ '--rise-delay': '200ms' }}>
            {aside}
          </div>
        )}
      </div>
    </section>
  );
}

export function SpotlightCard({ as: Tag = 'article', accent, className, children, ...rest }) {
  const onMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
  };
  return (
    <Tag
      onMouseMove={onMouseMove}
      className={cn('mkt-spotlight group relative h-full overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-6', className)}
      {...rest}
    >
      {accent && <span className={cn('absolute inset-x-0 top-0 h-1', accent)} />}
      {children}
    </Tag>
  );
}

export function CountUp({ value, suffix = '', duration = 1400, className }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const target = Number(value);
  const numeric = Number.isFinite(target);
  const [shown, setShown] = useState(numeric ? 0 : value);

  useEffect(() => {
    if (!numeric || !inView) return undefined;
    if (prefersReducedMotion()) {
      setShown(target);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      setShown(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const settle = setTimeout(() => setShown(target), duration + 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [inView, numeric, target, duration]);

  return (
    <span ref={ref} className={className}>
      {shown}
      {suffix}
    </span>
  );
}

export function ChannelMarquee({ items, dark = false, className }) {
  const row = [...items, ...items];
  return (
    <div className={cn('mkt-marquee', className)}>
      <div className="mkt-marquee-track">
        {row.map((item, index) => (
          <span
            key={`${item.name}-${index}`}
            aria-hidden={index >= items.length ? 'true' : undefined}
            className={cn('mkt-marquee-chip', dark && 'mkt-marquee-chip-dark')}
          >
            <span className={cn('h-2 w-2 rounded-full', item.dot)} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CtaBand({ eyebrow, title, highlight, text, children }) {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
      <Reveal className="mkt-hero relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-12 sm:py-16">
        <div className="mkt-hero-mesh" aria-hidden="true" />
        <div className="mkt-grid-bg" aria-hidden="true" />
        <div className="mkt-orb mkt-orb-a" aria-hidden="true" />
        <div className="relative mx-auto max-w-2xl">
          {eyebrow && <Eyebrow dark>{eyebrow}</Eyebrow>}
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {title}
            {highlight && (
              <>
                {' '}
                <span className="mkt-gradient-text-light">{highlight}</span>
              </>
            )}
          </h2>
          {text && <p className="mt-4 text-base leading-7 text-emerald-50/80">{text}</p>}
          {children && <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{children}</div>}
        </div>
      </Reveal>
    </section>
  );
}

export const CHANNEL_DOTS = [
  { name: 'Shopify', dot: 'bg-emerald-500' },
  { name: 'Amazon', dot: 'bg-amber-500' },
  { name: 'Myntra', dot: 'bg-pink-500' },
  { name: 'Flipkart', dot: 'bg-sky-500' },
  { name: 'Meesho', dot: 'bg-fuchsia-500' },
  { name: 'AJIO', dot: 'bg-slate-700' },
  { name: 'Nykaa', dot: 'bg-rose-500' },
  { name: 'Partner API', dot: 'bg-lime-500' },
];
