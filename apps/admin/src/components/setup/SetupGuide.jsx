import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, RefreshCw } from 'lucide-react';
import Button from '../ui/Button';
import PageLoader from '../ui/PageLoader';

function groupsOf(steps) {
  const groups = [];
  steps.forEach((item, index) => {
    const last = groups[groups.length - 1];
    const row = { ...item, number: index + 1 };
    if (!last || last.phase !== item.phase) {
      groups.push({ phase: item.phase, label: item.phaseLabel, steps: [row] });
    } else {
      last.steps.push(row);
    }
  });
  return groups;
}

export default function SetupGuide({
  title,
  subtitle,
  loading,
  error,
  checklist,
  onRefresh,
}) {
  const [selectedId, setSelectedId] = useState('');
  if (loading) return <PageLoader label="Checking setup…" />;

  const steps = checklist?.steps || [];
  const completed = checklist?.completed || 0;
  const total = checklist?.total || steps.length;
  const finished = total > 0 && completed === total;
  const activeId = steps.some((item) => item.id === selectedId)
    ? selectedId
    : (checklist?.nextId || steps[0]?.id || '');
  const active = steps.find((item) => item.id === activeId) || null;
  const activeNumber = active ? steps.findIndex((item) => item.id === active.id) + 1 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-emerald-700">
            {finished ? 'All steps complete' : `${completed} of ${total} complete`}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Check again
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav
          className="max-h-[28rem] overflow-y-auto rounded-2xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] p-2 lg:sticky lg:top-3 lg:max-h-[calc(100vh-7rem)]"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Setup steps"
        >
          {groupsOf(steps).map((group) => (
            <div key={group.phase} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Phase {group.phase} · {group.label}
              </p>
              {group.steps.map((item) => {
                const selected = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSelectedId(item.id)}
                    className={`mb-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-foreground transition-colors ${
                      selected
                        ? 'bg-emerald-600/10 ring-1 ring-emerald-600'
                        : 'hover:bg-[hsl(var(--color-muted))]'
                    }`}
                  >
                    <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">{item.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        item.done ? 'bg-emerald-600 text-white' : 'border border-dashed border-muted-foreground/40'
                      }`}
                      aria-label={item.done ? 'Complete' : 'Not complete'}
                    >
                      {item.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {active && (
          <section
            role="tabpanel"
            className="rounded-2xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] p-5 sm:p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step {activeNumber} of {total}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{active.title}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                active.done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
              }`}
              >
                {active.done ? 'Complete' : 'Still open'}
              </span>
            </div>

            <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${
              active.done
                ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-50'
                : 'bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50'
            }`}
            >
              {active.detail}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold">Where to click</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6">
                {(active.clicks || []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              {active.actionPath ? (
                <Link to={active.actionPath} className="mt-4 inline-flex">
                  <Button type="button">{active.actionLabel}</Button>
                </Link>
              ) : null}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold">Where to get the details</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                {(active.sources || []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <div className="mt-5 space-y-4 border-t border-[hsl(var(--color-border-premium))] pt-4">
              <div>
                <h3 className="text-sm font-semibold">Why this step</h3>
                <p className="mt-1 text-sm text-muted-foreground">{active.why}</p>
              </div>
              {!active.done && (
                <div>
                  <h3 className="text-sm font-semibold">If this stays open</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{active.impact}</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
