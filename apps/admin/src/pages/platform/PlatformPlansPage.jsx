import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';

const emptySlab = () => ({ upTo: '', rate: '' });

export default function PlatformPlansPage() {
  const [minimumMonthly, setMinimumMonthly] = useState('');
  const [slabs, setSlabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inquiries, setInquiries] = useState([]);

  useEffect(() => {
    api.get('/pricing/inquiries')
      .then(({ data }) => setInquiries(data.data || []))
      .catch(() => setInquiries([]));
    api.get('/pricing')
      .then(({ data }) => {
        const card = data.data || {};
        setMinimumMonthly(String(card.minimumMonthly ?? ''));
        setSlabs((card.slabs || []).map((slab) => ({
          upTo: slab.upTo == null ? '' : String(slab.upTo),
          rate: String(slab.rate),
        })));
      })
      .catch((err) => toast.error(apiError(err, 'Could not load pricing')))
      .finally(() => setLoading(false));
  }, []);

  const updateSlab = (index, key, value) => {
    setSlabs((current) => current.map((slab, i) => (i === index ? { ...slab, [key]: value } : slab)));
  };

  const addSlab = () => {
    setSlabs((current) => {
      const next = [...current];
      next.splice(Math.max(next.length - 1, 0), 0, emptySlab());
      return next;
    });
  };

  const removeSlab = (index) => {
    setSlabs((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/pricing', {
        minimumMonthly: Number(minimumMonthly),
        slabs: slabs.map((slab, index) => ({
          upTo: index === slabs.length - 1 ? null : Number(slab.upTo),
          rate: Number(slab.rate),
        })),
      });
      const card = data.data || {};
      setMinimumMonthly(String(card.minimumMonthly ?? ''));
      setSlabs((card.slabs || []).map((slab) => ({
        upTo: slab.upTo == null ? '' : String(slab.upTo),
        rate: String(slab.rate),
      })));
      toast.success('Pricing updated');
    } catch (err) {
      toast.error(apiError(err, 'Could not save pricing'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading pricing…" />;

  return (
    <PlatformPage
      title="Per-order pricing"
      subtitle="Every merchant pays this rate card. A month below the minimum is billed the minimum."
      action={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save pricing'}</Button>}
    >
      <div className="premium-card max-w-3xl space-y-5 p-6">
        <div className="max-w-xs">
          <label htmlFor="minimum" className="mb-1.5 block text-sm font-medium">Minimum per month (₹)</label>
          <Input id="minimum" inputMode="decimal" value={minimumMonthly} onChange={(event) => setMinimumMonthly(event.target.value)} />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Order slabs</p>
            <Button type="button" variant="outline" onClick={addSlab}>Add slab</Button>
          </div>
          {slabs.map((slab, index) => {
            const last = index === slabs.length - 1;
            return (
              <div key={index} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{last ? 'Orders' : 'Up to orders'}</label>
                  <Input
                    value={last ? 'And above' : slab.upTo}
                    disabled={last}
                    inputMode="numeric"
                    onChange={(event) => updateSlab(index, 'upTo', event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">₹ per order</label>
                  <Input inputMode="decimal" value={slab.rate} onChange={(event) => updateSlab(index, 'rate', event.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="outline" disabled={slabs.length <= 1 || last} onClick={() => removeSlab(index)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-base font-semibold">Pricing requests</h2>
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">No pricing requests yet.</TableCell>
                </TableRow>
              )}
              {inquiries.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.company || '—'}</p>
                    <p className="text-xs text-muted-foreground">{row.city || '—'} · {new Date(row.createdAt).toLocaleString()}</p>
                  </TableCell>
                  <TableCell>
                    <p>{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                    <p className="text-xs text-muted-foreground">{row.phone || '—'}</p>
                  </TableCell>
                  <TableCell>{[row.orders && `${row.orders} orders`, row.products && `${row.products} products`, row.channels].filter(Boolean).join(' · ') || '—'}</TableCell>
                  <TableCell className="max-w-[16rem] whitespace-normal text-sm">{row.message || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      </div>
    </PlatformPage>
  );
}
