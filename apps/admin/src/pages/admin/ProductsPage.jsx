import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { cn } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import { cachedPage, rememberPage } from '../../lib/pageCache';
import EmptyState from '../../components/ui/EmptyState';
import ProductThumb from '../../components/ui/ProductThumb';
import { FormBanner } from '../../components/ui/FormBanner';
import KpiCard from '../../components/ui/KpiCard';
import { Package, Plus, Search, Pencil, Trash2, Printer } from 'lucide-react';
import api, { apiError, apiFormError } from '../../lib/api';
import { printBarcodeLabel } from '../../lib/barcodeLabel';
import { productVariantRows, variantLabel, rowImage } from '../../lib/productRows';
import { usePermissions } from '../../hooks/usePermissions';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';

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

export default function ProductsPage() {
  const navigate = useNavigate();
  const { canCatalogEdit } = usePermissions();
  const seed = cachedPage('products');
  const [rows, setRows] = useState(seed?.rows || []);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(seed?.total || 0);
  const [stats, setStats] = useState(seed?.stats || { active: 0, variants: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const [edit, setEdit] = useState(null);
  const [banner, setBanner] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products', { params: { q: searchQuery, page, limit: PAGE_SIZE } });
      const next = { rows: data.data || [], total: data.meta?.total || 0, stats: { active: data.meta?.active || 0, variants: data.meta?.variants || 0 } };
      setRows(next.rows);
      setTotal(next.total);
      setStats(next.stats);
      if (page === 1 && !searchQuery) rememberPage('products', next);
    } catch (err) {
      toast.error(apiError(err, 'Could not load products'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page]);

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
        images: String(edit.imagesText ?? (edit.images || []).join('\n'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      toast.success('Product updated');
      setEditOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const removeProduct = async (product) => {
    if (!window.confirm(`Delete ${product.name}? Stock or channel mappings archive it instead of removing it.`)) return;
    try {
      const { data } = await api.delete(`/products/${product.id}`);
      toast.success(data.message || 'Product updated');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete product'));
    }
  };

  const uploadImage = async (file) => {
    if (!edit?.id || !file) return;
    const body = new FormData();
    body.append('image', file);
    setBanner('');
    try {
      const { data } = await api.post(`/products/${edit.id}/images`, body);
      const next = data.data;
      setEdit({
        ...edit,
        ...next,
        imagesText: (next.images || []).join('\n'),
      });
      toast.success('Image uploaded');
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  if (loading && rows.length === 0) return <PageLoader label="Loading products..." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-muted-foreground">
            Catalog shell. Each color/size variant is one Master SKU. In Stock shows on-hand qty in the Offline (WH-001) and Virtual (WH-002) warehouses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        <KpiCard label="Products" value={total} icon={Package} />
        <KpiCard label="Active" value={stats.active} icon={Package} />
        <KpiCard label="Variants (Master SKUs)" value={stats.variants} icon={Package} />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search name, vendor, category or HSN..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
              />
            </div>
            <Button variant="outline" onClick={() => { if (page === 1) load(); else setPage(1); }}>Search</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product catalog ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent aria-busy={loading} className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')}>
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
                  <TableHead>Master SKU</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>GST %</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead className="text-right">In Stock (Shopify Offline/Amazon/Myntra)</TableHead>
                  <TableHead className="text-right">In Stock (Virtual)</TableHead>
                  <TableHead>Status</TableHead>
                  {canCatalogEdit && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {productVariantRows(rows).map(({ key, product, variant: v }) => (
                  <TableRow key={key}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProductThumb name={product.name} sku={v?.code || product.name} src={rowImage(product, v)} size="lg" />
                        <div>
                          <div className="font-medium">{product.name}</div>
                          {variantLabel(v) && <div className="text-xs">{variantLabel(v)}</div>}
                          <div className="text-xs text-muted-foreground">
                            {[product.brand, product.category].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {v ? (
                        <div className="flex items-center gap-1 font-mono text-xs">
                          {v.code}
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Print barcode (51 x 25 mm PDF)"
                            aria-label={`Print barcode for ${v.code}`}
                            onClick={() => {
                              try {
                                printBarcodeLabel({ value: v.barcode || v.code, name: product.name });
                              } catch (err) {
                                toast.error(err.message);
                              }
                            }}
                          >
                            <Printer className="w-3 h-3" />
                          </button>
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{product.hsnCode || '—'}</TableCell>
                    <TableCell>{product.gstRatePercent}%</TableCell>
                    <TableCell>{formatINR(v?.sellingPrice || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{v?.stock?.offline ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{v?.stock?.virtual ?? 0}</TableCell>
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
                            onClick={() => {
                              setEdit({ ...product, imagesText: (product.images || []).join('\n') });
                              setBanner('');
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => removeProduct(product)}>
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
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
              <label className="text-sm font-medium">Vendor</label>
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
                <label className="text-sm font-medium">Vendor</label>
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
            <div>
              <label className="text-sm font-medium">Image URLs (one per line)</label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={edit.imagesText ?? (edit.images || []).join('\n')}
                onChange={(e) => setEdit({ ...edit, imagesText: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Upload image</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  uploadImage(file);
                }}
              />
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
