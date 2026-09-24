import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { formatINR, statusBadgeVariant } from '../../utils/format';
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
import KpiCard from '../../components/ui/KpiCard';
import { Package, Plus, Search, Pencil } from 'lucide-react';
import api, { apiError, apiFormError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const emptyProduct = {
  name: '',
  brand: '',
  category: '',
  hsnCode: '',
  gstRatePercent: 5,
  color: '',
  size: '',
  barcode: '',
  sellingPrice: '',
  mrp: '',
};

const emptyVariant = {
  color: '',
  size: '',
  barcode: '',
  sellingPrice: '',
  mrp: '',
};

export default function ProductsPage() {
  const navigate = useNavigate();
  const { canCatalogEdit } = usePermissions();
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const [edit, setEdit] = useState(null);
  const [variantForm, setVariantForm] = useState(emptyVariant);
  const [banner, setBanner] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products', { params: { q: searchQuery } });
      setRows(data.data || []);
    } catch (err) {
      toast.error(apiError(err, 'Could not load products'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBanner('');
    try {
      await api.post('/products', {
        name: form.name,
        brand: form.brand,
        category: form.category,
        hsnCode: form.hsnCode,
        gstRatePercent: Number(form.gstRatePercent),
        variants: [{
          name: form.name,
          barcode: form.barcode,
          sellingPrice: Number(form.sellingPrice) || 0,
          mrp: Number(form.mrp) || 0,
          variantAttributes: {
            ...(form.color ? { color: form.color } : {}),
            ...(form.size ? { size: form.size } : {}),
          },
        }],
      });
      toast.success('Product created with a Master SKU');
      setCreateOpen(false);
      setForm(emptyProduct);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const saveEdit = async () => {
    setBanner('');
    try {
      await api.patch(`/products/${edit.id}`, {
        name: edit.name,
        brand: edit.brand,
        category: edit.category,
        hsnCode: edit.hsnCode,
        gstRatePercent: Number(edit.gstRatePercent),
        status: edit.status,
      });
      toast.success('Product updated');
      setEditOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const saveVariant = async () => {
    setBanner('');
    try {
      await api.post(`/products/${edit.id}/variants`, {
        name: edit.name,
        barcode: variantForm.barcode,
        sellingPrice: Number(variantForm.sellingPrice) || 0,
        mrp: Number(variantForm.mrp) || 0,
        variantAttributes: {
          ...(variantForm.color ? { color: variantForm.color } : {}),
          ...(variantForm.size ? { size: variantForm.size } : {}),
        },
      });
      toast.success('Master SKU variant added');
      setVariantOpen(false);
      setVariantForm(emptyVariant);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  if (loading) return <PageLoader label="Loading products..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Products</h1>
          <p className="text-muted-foreground">
            Catalog shell. Each color/size variant is one Master SKU. Stock comes in the inventory phase — not here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/import')}>Bulk import</Button>
          <Button variant="outline" onClick={() => navigate('/master-sku')}>Master SKU</Button>
          {canCatalogEdit && (
            <Button onClick={() => { setForm(emptyProduct); setBanner(''); setCreateOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Products" value={rows.length} icon={Package} />
        <KpiCard label="Active" value={rows.filter((p) => p.status === 'active').length} icon={Package} />
        <KpiCard label="Variants (Master SKUs)" value={rows.reduce((n, p) => n + (p.variantCount || 0), 0)} icon={Package} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search name, brand, category or HSN..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
            </div>
            <Button variant="outline" onClick={load}>Search</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product catalog ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="No products yet"
              description="Create a product or import Shopify CSV first."
              action={canCatalogEdit && <Button onClick={() => setCreateOpen(true)}>Add product</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Master SKUs</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>GST %</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  {canCatalogEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[product.brand, product.category].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(product.variants || []).map((v) => (
                        <div key={v.id} className="font-mono text-xs">{v.code}</div>
                      ))}
                    </TableCell>
                    <TableCell>{product.hsnCode || '—'}</TableCell>
                    <TableCell>{product.gstRatePercent}%</TableCell>
                    <TableCell>{formatINR(product.variants?.[0]?.sellingPrice || 0)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(product.status === 'active' ? 'Active' : product.status)}>
                        {product.status}
                      </Badge>
                    </TableCell>
                    {canCatalogEdit && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setEdit(product); setBanner(''); setEditOpen(true); }}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEdit(product);
                              setVariantForm(emptyVariant);
                              setBanner('');
                              setVariantOpen(true);
                            }}
                          >
                            Add variant
                          </Button>
                        </div>
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
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Add product"
        description="Creates the product shell plus the first Master SKU variant."
        footer={(
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={save}>Create + Master SKU</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Brand</label>
              <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">HSN</label>
              <Input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">GST %</label>
              <Select value={String(form.gstRatePercent)} onChange={(e) => setForm({ ...form, gstRatePercent: Number(e.target.value) })}>
                {[0, 5, 12, 18, 28].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
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
        title="Edit product"
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
              <label className="text-sm font-medium">Name</label>
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Brand</label>
                <Input value={edit.brand || ''} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <Input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">HSN</label>
                <Input value={edit.hsnCode || ''} onChange={(e) => setEdit({ ...edit, hsnCode: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">GST %</label>
                <Select value={String(edit.gstRatePercent ?? 5)} onChange={(e) => setEdit({ ...edit, gstRatePercent: Number(e.target.value) })}>
                  {[0, 5, 12, 18, 28].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="archived">archived</option>
              </Select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={variantOpen}
        onOpenChange={setVariantOpen}
        title="Add variant"
        description={edit ? `New Master SKU under ${edit.name}. Code auto-generates.` : ''}
        footer={(
          <>
            <Button variant="outline" onClick={() => setVariantOpen(false)}>Cancel</Button>
            <Button onClick={saveVariant}>Create Master SKU</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Color</label>
              <Input value={variantForm.color} onChange={(e) => setVariantForm({ ...variantForm, color: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">Size</label>
              <Input value={variantForm.size} onChange={(e) => setVariantForm({ ...variantForm, size: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Barcode / EAN</label>
            <Input value={variantForm.barcode} onChange={(e) => setVariantForm({ ...variantForm, barcode: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm font-medium">Selling price</label>
              <Input type="number" value={variantForm.sellingPrice} onChange={(e) => setVariantForm({ ...variantForm, sellingPrice: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">MRP</label>
              <Input type="number" value={variantForm.mrp} onChange={(e) => setVariantForm({ ...variantForm, mrp: e.target.value })} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
