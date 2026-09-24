import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { formatINR } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { FormBanner } from '../../components/ui/FormBanner';
import { Barcode, Pencil, Plus, Search } from 'lucide-react';
import api, { apiError, apiFormError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const empty = { name: '', code: '', color: '', size: '', barcode: '', sellingPrice: '', mrp: '', hsnCode: '' };

export default function MasterSkuPage() {
  const navigate = useNavigate();
  const { canCatalogEdit } = usePermissions();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [edit, setEdit] = useState(null);
  const [banner, setBanner] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/master-skus', { params: { q } });
      setRows(data.data || []);
    } catch (err) {
      toast.error(apiError(err, 'Could not load Master SKUs'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBanner('');
    try {
      await api.post('/master-skus', {
        name: form.name,
        code: form.code || undefined,
        barcode: form.barcode,
        sellingPrice: Number(form.sellingPrice) || 0,
        mrp: Number(form.mrp) || 0,
        hsnCode: form.hsnCode,
        variantAttributes: {
          ...(form.color ? { color: form.color } : {}),
          ...(form.size ? { size: form.size } : {}),
        },
      });
      toast.success('Master SKU created');
      setOpen(false);
      setForm(empty);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const saveEdit = async () => {
    setBanner('');
    try {
      await api.patch(`/master-skus/${edit.id}`, {
        name: edit.name,
        barcode: edit.barcode,
        sellingPrice: Number(edit.sellingPrice) || 0,
        mrp: Number(edit.mrp) || 0,
        hsnCode: edit.hsnCode,
        status: edit.status,
        variantAttributes: edit.variantAttributes,
        ...(!edit.codeLocked && edit.code ? { code: edit.code } : {}),
      });
      toast.success('Master SKU updated');
      setEditOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  if (loading) return <PageLoader label="Loading Master SKUs..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Master SKU</h1>
          <p className="text-muted-foreground">
            One internal identity per sellable variant. After the first channel mapping, the code is locked.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/sku-mapping')}>SKU mapping</Button>
          {canCatalogEdit && (
            <Button onClick={() => { setForm(empty); setBanner(''); setOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Create Master SKU
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                placeholder="Search code, name or barcode..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
            </div>
            <Button variant="outline" onClick={load}>Search</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Master SKU catalog ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="No Master SKUs"
              description="Create from Products, or import Shopify CSV first."
              action={<Button variant="outline" onClick={() => navigate('/import')}>Bulk import</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Attributes</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Locked</TableHead>
                  {canCatalogEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((sku) => (
                  <TableRow key={sku.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Barcode className="w-4 h-4 text-muted-foreground" />
                        {sku.code}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{sku.name}</div>
                      <div className="text-xs text-muted-foreground">{sku.hsnCode || sku.productName || ''}</div>
                    </TableCell>
                    <TableCell>
                      {Object.entries(sku.variantAttributes || {}).length === 0
                        ? '—'
                        : Object.entries(sku.variantAttributes || {}).map(([k, v]) => (
                          <div key={k} className="text-sm"><span className="text-muted-foreground">{k}:</span> {v}</div>
                        ))}
                    </TableCell>
                    <TableCell>{sku.barcode || '—'}</TableCell>
                    <TableCell>{formatINR(sku.sellingPrice || 0)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(sku.channelMappings || []).length === 0
                          ? <Badge variant="secondary">none</Badge>
                          : sku.channelMappings.map((m) => (
                            <Badge key={m.id} variant="outline">{m.channel}</Badge>
                          ))}
                      </div>
                    </TableCell>
                    <TableCell>{sku.codeLocked ? 'Yes' : 'No'}</TableCell>
                    {canCatalogEdit && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setEdit({ ...sku }); setBanner(''); setEditOpen(true); }}
                        >
                          <Pencil className="w-3 h-3 mr-1" />
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create Master SKU"
        footer={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Create</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <p className="text-sm text-muted-foreground">Leave code blank to auto-generate from tenant prefix + name + attributes.</p>
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Code (optional)</label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="LH-KURTA-BLUE" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Color</label>
              <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Size</label>
              <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Barcode / EAN</label>
            <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">HSN</label>
            <Input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Selling price</label>
              <Input type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">MRP</label>
              <Input type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit Master SKU"
        footer={(
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </>
        )}
      >
        {edit && (
          <div className="space-y-3">
            {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
            <div>
              <label className="text-sm font-medium">Code</label>
              <Input
                value={edit.code}
                disabled={edit.codeLocked}
                onChange={(e) => setEdit({ ...edit, code: e.target.value })}
              />
              {edit.codeLocked && <p className="text-xs text-muted-foreground mt-1">Locked after first channel mapping.</p>}
            </div>
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Barcode / EAN</label>
              <Input value={edit.barcode || ''} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">HSN</label>
              <Input value={edit.hsnCode || ''} onChange={(e) => setEdit({ ...edit, hsnCode: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Selling price</label>
                <Input type="number" value={edit.sellingPrice ?? ''} onChange={(e) => setEdit({ ...edit, sellingPrice: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">MRP</label>
                <Input type="number" value={edit.mrp ?? ''} onChange={(e) => setEdit({ ...edit, mrp: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={edit.status || 'active'} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="active">active</option>
                <option value="discontinued">discontinued</option>
              </Select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
