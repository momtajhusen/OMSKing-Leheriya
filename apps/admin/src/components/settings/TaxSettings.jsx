import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Pencil, Save, Trash2 } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import api, { apiError } from '../../lib/api';

function parseHsnCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV needs a header and at least one HSN row');
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  if (col('hsn') < 0) throw new Error('CSV needs an hsn column');
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const gst = col('gstrate') >= 0 ? cells[col('gstrate')] : '';
    return {
      hsn: cells[col('hsn')] || '',
      description: col('description') >= 0 ? cells[col('description')] || '' : '',
      gstRate: gst === '' || gst == null ? null : Number(gst),
      sku: col('sku') >= 0 ? cells[col('sku')] || '' : '',
    };
  });
}

export default function TaxSettings() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [defaultGstRate, setDefaultGstRate] = useState('18');
  const [categories, setCategories] = useState([]);
  const [hsnCount, setHsnCount] = useState(0);
  const [hsnPreview, setHsnPreview] = useState([]);
  const [hsnEdit, setHsnEdit] = useState(null);
  const [hsnRemoving, setHsnRemoving] = useState(null);

  useEffect(() => {
    api.get('/settings/tax')
      .then(({ data }) => {
        const tax = data.data || {};
        setDefaultGstRate(String(tax.defaultGstRate ?? 18));
        setCategories(tax.categories || []);
        setHsnCount(tax.hsnCount || 0);
        setHsnPreview(tax.hsnMaster || []);
      })
      .catch((err) => toast.error(apiError(err, 'Could not load tax settings')))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch('/settings/tax', {
        defaultGstRate: Number(defaultGstRate),
        categories: categories.map((row) => ({ name: row.name, gstRate: Number(row.gstRate) })),
      });
      const tax = data.data || {};
      setDefaultGstRate(String(tax.defaultGstRate ?? defaultGstRate));
      setCategories(tax.categories || []);
      toast.success('Tax settings saved');
    } catch (err) {
      toast.error(apiError(err, 'Could not save tax settings'));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = 'hsn,description,gstRate,sku\n6109,T-shirts,5,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hsn-master-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const rows = parseHsnCsv(await file.text());
      const { data } = await api.post('/settings/tax/hsn', { rows });
      const tax = data.data || {};
      setHsnCount(tax.hsnCount || 0);
      setHsnPreview(tax.hsnMaster || []);
      const unmatched = tax.unmatched || [];
      const applied = tax.appliedCount || 0;
      toast.success(unmatched.length
        ? `HSN saved. ${applied} SKU updated. Unmatched: ${unmatched.slice(0, 5).join(', ')}`
        : `HSN master saved${applied ? `. ${applied} SKU updated` : ''}`);
    } catch (err) {
      toast.error(err?.response ? apiError(err, 'Could not upload HSN master') : err.message);
    } finally {
      setBusy(false);
    }
  };

  const showHsn = (tax) => {
    setHsnCount(tax.hsnCount || 0);
    setHsnPreview(tax.hsnMaster || []);
  };

  const saveHsnRow = async () => {
    try {
      const { data } = await api.patch(`/settings/tax/hsn/${hsnEdit.hsn}`, {
        description: hsnEdit.description,
        gstRate: hsnEdit.gstRate === '' ? null : hsnEdit.gstRate,
      });
      showHsn(data.data || {});
      setHsnEdit(null);
      toast.success(`HSN ${hsnEdit.hsn} saved`);
    } catch (err) {
      toast.error(apiError(err, 'Could not save this HSN code'));
    }
  };

  const deleteHsnRow = async () => {
    try {
      const { data } = await api.delete(`/settings/tax/hsn/${hsnRemoving.hsn}`);
      showHsn(data.data || {});
      toast.success(`HSN ${hsnRemoving.hsn} deleted`);
      setHsnRemoving(null);
    } catch (err) {
      toast.error(apiError(err, 'Could not delete this HSN code'));
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading tax settings…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">Default GST Rate (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          value={defaultGstRate}
          onChange={(e) => setDefaultGstRate(e.target.value)}
          className="premium-input max-w-xs"
        />
        <p className="text-xs text-muted-foreground">Used when a product has no category rate. India default is 18%.</p>
      </div>

      <div className="pt-6 border-t border-[hsl(var(--color-border-premium))]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-medium">Tax rates by category</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCategories((rows) => [...rows, { name: '', gstRate: defaultGstRate || 18 }])}
          >
            Add category
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>GST Rate</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((row, index) => (
              <TableRow key={`${row.name}-${index}`}>
                <TableCell>
                  <input
                    value={row.name}
                    onChange={(e) => setCategories((rows) => rows.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))}
                    className="premium-input"
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={row.gstRate}
                    onChange={(e) => setCategories((rows) => rows.map((item, i) => (i === index ? { ...item, gstRate: e.target.value } : item)))}
                    className="premium-input w-24"
                  />
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCategories((rows) => rows.filter((_, i) => i !== index))}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="pt-6 border-t border-[hsl(var(--color-border-premium))] space-y-3">
        <h3 className="font-medium">HSN code master</h3>
        <p className="text-sm text-muted-foreground">
          CSV columns: hsn, description, gstRate, sku. A sku column updates that master SKU and its product. {hsnCount} codes saved.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={downloadTemplate}>Download template</Button>
          <label className="inline-flex cursor-pointer items-center rounded-md border border-[hsl(var(--color-border-premium))] px-3 py-2 text-sm font-medium">
            Upload HSN master file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} disabled={busy} />
          </label>
        </div>
        {hsnPreview.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded-lg border border-[hsl(var(--color-border-premium))]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>HSN</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>GST</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hsnPreview.map((row) => (hsnEdit?.hsn === row.hsn ? (
                <TableRow key={row.hsn}>
                  <TableCell className="font-mono text-xs">{row.hsn}</TableCell>
                  <TableCell>
                    <input
                      value={hsnEdit.description}
                      onChange={(e) => setHsnEdit({ ...hsnEdit, description: e.target.value })}
                      className="premium-input"
                      aria-label={`Description for HSN ${row.hsn}`}
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={hsnEdit.gstRate}
                      onChange={(e) => setHsnEdit({ ...hsnEdit, gstRate: e.target.value })}
                      className="premium-input w-24"
                      aria-label={`GST rate for HSN ${row.hsn}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="sm" onClick={saveHsnRow}>Save</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setHsnEdit(null)}>Cancel</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.hsn}>
                  <TableCell className="font-mono text-xs">{row.hsn}</TableCell>
                  <TableCell>{row.description || '—'}</TableCell>
                  <TableCell>{row.gstRate == null ? '—' : `${row.gstRate}%`}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit HSN ${row.hsn}`}
                        onClick={() => setHsnEdit({ hsn: row.hsn, description: row.description || '', gstRate: row.gstRate ?? '' })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="text-destructive" aria-label={`Delete HSN ${row.hsn}`} onClick={() => setHsnRemoving(row)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(hsnRemoving)}
        title={`Delete HSN ${hsnRemoving?.hsn || ''}?`}
        onConfirm={deleteHsnRow}
        onClose={() => setHsnRemoving(null)}
      >
        It is removed from the HSN master. Master SKUs that already carry this code keep it until you change them.
      </ConfirmDialog>

      <div className="pt-6 border-t border-[hsl(var(--color-border-premium))]">
        <button type="button" className="premium-button" onClick={save} disabled={busy}>
          <Save className="w-4 h-4 mr-2" />
          {busy ? 'Saving…' : 'Save tax settings'}
        </button>
      </div>
    </div>
  );
}
