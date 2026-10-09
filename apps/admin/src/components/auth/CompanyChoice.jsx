export default function CompanyChoice({ companies, register, error }) {
  if (!companies?.length) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">Which company?</legend>
      <div className="space-y-2">
        {companies.map((company) => (
          <label key={company.slug} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
            <input type="radio" value={company.slug} className="accent-emerald-700" {...register('workspace')} />
            {company.name}
          </label>
        ))}
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">{error}</p>}
    </fieldset>
  );
}

export function companiesFromError(err) {
  const rows = err?.response?.data?.data?.companies;
  return Array.isArray(rows) ? rows : [];
}
