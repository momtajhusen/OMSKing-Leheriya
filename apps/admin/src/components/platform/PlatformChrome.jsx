export function PlatformPage({ title, subtitle, action, children }) {
  return (
    <div className="vendor-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function PlatformSheet({ children }) {
  return (
    <div className="vendor-sheet">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
