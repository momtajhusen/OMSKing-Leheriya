import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Package } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { FormBanner } from '../ui/FormBanner';
import api, { apiError, apiFormError } from '../../lib/api';

const FIELDS = [
  { key: 'weightKg', label: 'Weight (kg)', step: '0.01' },
  { key: 'lengthCm', label: 'Length (cm)', step: '0.1' },
  { key: 'breadthCm', label: 'Breadth (cm)', step: '0.1' },
  { key: 'heightCm', label: 'Height (cm)', step: '0.1' },
];

const blank = { weightKg: '', lengthCm: '', breadthCm: '', heightCm: '' };

export default function PackageDefaultsCard() {
  const [form, setForm] = useState(blank);
  const [applyToAll, setApplyToAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState('');

  useEffect(() => {
    api.get('/settings/package-defaults')
      .then(({ data }) => setForm({ ...blank, ...(data.data || {}) }))
      .catch((err) => toast.error(apiError(err, 'Could not load default package')));
  }, []);

  const save = async () => {
    setBanner('');
    setSaving(true);
    try {
      const { data } = await api.patch('/settings/package-defaults', {
        weightKg: Number(form.weightKg) || 0,
        lengthCm: Number(form.lengthCm) || 0,
        breadthCm: Number(form.breadthCm) || 0,
        heightCm: Number(form.heightCm) || 0,
        applyToAll,
      });
      const saved = data.data || {};
      setForm({ ...blank, ...(saved.defaults || {}) });
      setApplyToAll(false);
      toast.success(applyToAll ? `Default package saved and applied to ${saved.appliedCount || 0} products` : 'Default package saved');
    } catch (err) {
      setBanner(apiFormError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[hsl(var(--color-border-premium))] p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Package className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <h3 className="font-semibold">Default package (all products)</h3>
          <p className="text-sm text-muted-foreground">
            Weight and size sent to the courier when a product has no weight or size of its own. Courier charges are decided on this.
          </p>
        </div>
      </div>
      {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className="text-xs font-medium">{field.label}</label>
            <Input
              type="number"
              min="0"
              step={field.step}
              value={form[field.key] ?? ''}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
          Also set this weight and size on every product (overwrites each product’s own values)
        </label>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save default'}</Button>
      </div>
    </div>
  );
}
