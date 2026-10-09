import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useVendorStore from '../../stores/vendorStore';
import useOrderStore from '../../stores/orderStore';
import { ordersForVendor } from '../../lib/orderSubOrders';
import api, { apiError } from '../../lib/api';
import { statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import ProductThumb from '../../components/ui/ProductThumb';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { PasswordHints } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
import { ROLES } from '../../constants/roles';
import { Store, Plus, MessageCircle, MapPin, Package, Search, Trash2, RefreshCw, Eye } from 'lucide-react';

const emptyVendor = { name: '', location: '', phone: '', email: '', telegramGroup: '' };

function passwordProblem(password, confirm) {
  if (!password && !confirm) return '';
  if (password !== confirm) return 'Password and confirm password do not match';
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password needs 8 characters, an uppercase letter, a lowercase letter, and a number';
  }
  return '';
}

export default function VendorsPage() {
  const navigate = useNavigate();
  const { effectiveRole } = useAuth();
  const canSetPassword = effectiveRole === ROLES.SUPER_ADMIN;
  const [activeTab, setActiveTab] = useState('all');
  const allVendors = useVendorStore((s) => s.vendors);
  const autoAssign = useVendorStore((s) => s.autoAssign);
  const setAutoAssign = useVendorStore((s) => s.setAutoAssign);
  const saveVendorRecord = useVendorStore((s) => s.saveVendor);
  const setVendorStatus = useVendorStore((s) => s.setStatus);
  const removeVendor = useVendorStore((s) => s.removeVendor);
  const addShopifyVendors = useVendorStore((s) => s.addShopifyVendors);
  const vendorList = useMemo(() => allVendors.filter((vendor) => !vendor.removed), [allVendors]);
  const [open, setOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyVendor);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [ordersVendor, setOrdersVendor] = useState(null);
  const [itemsOrder, setItemsOrder] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allOrders = useOrderStore((s) => s.orders);
  const hydrateOrders = useOrderStore((s) => s.hydrateFromApi);
  const loaded = useVendorStore((s) => s.loaded);
  const loadError = useVendorStore((s) => s.error);
  const loadVendors = useVendorStore((s) => s.load);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadVendors();
    hydrateOrders();
  }, [loadVendors, hydrateOrders]);

  const filtered = useMemo(() => vendorList.filter((vendor) => {
    const matchesTab = activeTab === 'all' || vendor.status === activeTab;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || vendor.name.toLowerCase().includes(q) || vendor.phone.includes(searchQuery) || vendor.location.toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  }), [vendorList, activeTab, searchQuery]);

  const kpiData = {
    total: vendorList.length,
    active: vendorList.filter((v) => v.status === 'Active').length,
    inactive: vendorList.filter((v) => v.status === 'Inactive').length,
    totalOrders: vendorList.reduce((sum, v) => sum + v.assignedOrders, 0),
  };

  const vendorOrders = ordersForVendor(allOrders, ordersVendor?.name);

  const sharedPhone = (phone, skipId) =>
    vendorList.filter((v) => v.id !== skipId && v.phone.replace(/\s/g, '') === phone.replace(/\s/g, '')).map((v) => v.name);

  const saveVendor = async () => {
    if (!form.name.trim() || (!form.phone.trim() && editing?.source !== 'shopify')) {
      toast.error('Name and phone are required');
      return;
    }
    const passwordError = canSetPassword ? passwordProblem(password, confirmPassword) : '';
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    if (canSetPassword && password && !form.email.trim()) {
      toast.error('Add an email before setting the vendor login password');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await saveVendorRecord(form, editing.id);
        if (canSetPassword && password) {
          await api.post(`/vendors/${editing.id}/password`, { password });
          toast.success(`${form.name} updated. Login password saved for ${form.email.trim()}`);
        } else {
          toast.success(`${form.name} updated`);
        }
      } else {
        const others = sharedPhone(form.phone);
        const created = await saveVendorRecord(form);
        if (canSetPassword && password && created?.id) {
          await api.post(`/vendors/${created.id}/password`, { password });
        }
        toast.success(others.length ? `${form.name} added. Same phone already used by ${others.join(', ')}.` : `${form.name} added`);
      }
      setForm(emptyVendor);
      setPassword('');
      setConfirmPassword('');
      setEditing(null);
      setOpen(false);
    } catch (err) {
      toast.error(apiError(err, 'Could not save vendor'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (vendor) => {
    const next = vendor.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await setVendorStatus(vendor.id, next);
      toast.success(`${vendor.name} marked ${next}`);
    } catch (err) {
      toast.error(apiError(err, 'Could not change status'));
    }
  };

  const pullShopify = async () => {
    setPulling(true);
    try {
      const { data } = await api.get('/channels/shopify/vendors');
      const added = await addShopifyVendors(data.data || []);
      const count = (data.data || []).length;
      if (!count) toast.success('Shopify returned no vendor names');
      else if (!added) toast.success('Those Shopify vendor names are already on this list');
      else toast.success(`${added} vendor name${added === 1 ? '' : 's'} added from Shopify`);
    } catch (err) {
      toast.error(apiError(err, 'Could not fetch Shopify vendors'));
    } finally {
      setPulling(false);
    }
  };

  const closeVendor = () => {
    setOpen(false);
    setEditing(null);
    setConfirmDelete(false);
    setPassword('');
    setConfirmPassword('');
  };

  const openEdit = (vendor) => {
    setEditing(vendor);
    setConfirmDelete(false);
    setPassword('');
    setConfirmPassword('');
    setForm({
      name: vendor.name,
      location: vendor.location,
      phone: vendor.phone,
      email: vendor.email || '',
      telegramGroup: vendor.telegramGroup || '',
    });
    setOpen(true);
  };

  const deleteVendor = async () => {
    if (!editing) return;
    try {
      await removeVendor(editing.id);
    } catch (err) {
      toast.error(apiError(err, 'Could not remove vendor'));
      return;
    }
    if (ordersVendor?.id === editing.id) setOrdersVendor(null);
    toast.success(`${editing.name} removed from the list. Reports still show this name.`);
    setForm(emptyVendor);
    closeVendor();
  };

  if (!loaded) return <PageLoader label="Loading vendors..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Vendors</h1>
          <p className="text-muted-foreground">Accept / reject, dispatch, bulk AWB. Same phone number can exist on more than one vendor.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={pulling} onClick={pullShopify}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Fetch from Shopify
          </Button>
          <Button onClick={() => { setEditing(null); setConfirmDelete(false); setPassword(''); setConfirmPassword(''); setForm(emptyVendor); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Add Vendor
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-4 py-3">
        <div>
          <p className="font-medium">Auto assignment</p>
          <p className="text-sm text-muted-foreground">When on, fulfilment assigns the Shopify vendor name automatically if that vendor is still on this list.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoAssign}
          aria-label="Auto assignment"
          onClick={() => {
            const next = !autoAssign;
            setAutoAssign(next);
            toast.success(next ? 'Auto assignment is on' : 'Auto assignment is off');
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${autoAssign ? 'bg-primary' : 'bg-muted'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${autoAssign ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Vendors" value={kpiData.total} icon={Store} onClick={() => setActiveTab('all')} />
        <KpiCard label="Active" value={kpiData.active} icon={Store} onClick={() => setActiveTab('Active')} />
        <KpiCard label="Inactive" value={kpiData.inactive} icon={Store} onClick={() => setActiveTab('Inactive')} />
        <KpiCard label="Total Orders" value={kpiData.totalOrders} icon={Package} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap">
          {['all', 'Active', 'Inactive'].map((tab) => (
            <Button key={tab} variant={activeTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab)}>
              {tab === 'all' ? 'All' : tab}
            </Button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search vendors..."
            className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loadError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={vendorList.length ? 'No vendors in this view' : 'No vendors yet'}
          description={vendorList.length ? 'Clear search or change the tab.' : 'Add a vendor or fetch vendor names from Shopify. Fulfilment can only assign saved vendors.'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          {filtered.map((vendor) => (
            <Card key={vendor.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Store className="w-5 h-5" />
                      {vendor.name}
                      {vendor.source === 'shopify' && <Badge variant="outline">Shopify</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {vendor.location}
                      </div>
                    </CardDescription>
                  </div>
                  <Badge variant={vendor.status === 'Active' ? 'outline' : 'secondary'}>{vendor.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Assigned Orders</p>
                      <p className="text-xl font-bold">{vendor.assignedOrders}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="text-sm font-medium">{vendor.phone || '—'}</p>
                    </div>
                  </div>
                  {vendor.telegramGroup && (
                    <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
                      <MessageCircle className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">Telegram Group</span>
                      <Badge variant="outline" className="ml-auto">Active</Badge>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setOrdersVendor(vendor)}>View Orders</Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(vendor)}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => { openEdit(vendor); setConfirmDelete(true); }}>Delete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vendor List</CardTitle>
          <CardDescription>Removing a vendor hides them here. Their name stays on reports. Shopify names can be removed the same way.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assigned Orders</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Telegram Group</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {vendor.name}
                      {vendor.source === 'shopify' && <Badge variant="outline">Shopify</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>{vendor.location}</TableCell>
                  <TableCell>{vendor.phone || '—'}</TableCell>
                  <TableCell>{vendor.assignedOrders}</TableCell>
                  <TableCell>
                    <Badge variant={vendor.status === 'Active' ? 'outline' : 'secondary'}>{vendor.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {vendor.telegramGroup ? (
                      <Badge variant="outline" className="gap-1"><MessageCircle className="w-3 h-3" />Connected</Badge>
                    ) : (
                      <Badge variant="secondary">Not Connected</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(vendor)}>Manage</Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleStatus(vendor)}>
                        {vendor.status === 'Active' ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { openEdit(vendor); setConfirmDelete(true); }}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Modal
        open={!!ordersVendor}
        onOpenChange={(openState) => { if (!openState) { setOrdersVendor(null); setItemsOrder(null); } }}
        title={ordersVendor ? `${ordersVendor.name} orders` : 'Vendor orders'}
        description="Click a row for the full order page, or View items for product photo, title, SKU and qty."
        className="max-w-5xl"
      >
        {vendorOrders.length === 0 ? (
          <EmptyState title="No assigned orders yet" description="Fulfilment assignments will show here." />
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorOrders.map((order) => {
                const line = order.line;
                const first = order.items?.[0];
                const title = line?.title || first?.name || '—';
                const sku = line?.sku || first?.sku || '—';
                const qty = line?.qty || first?.qty || 0;
                const photo = line?.imageUrl || first?.imageUrl;
                return (
                  <TableRow
                    key={order.displayId}
                    className="cursor-pointer"
                    onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}
                  >
                    <TableCell className="font-medium whitespace-nowrap">
                      <span className="text-primary">{order.displayId}</span>
                      {order.displayId !== order.id && (
                        <div className="text-[11px] text-muted-foreground">{order.id}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-[180px] items-center gap-2">
                        <ProductThumb name={title} src={photo} />
                        <span className="leading-tight">{title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{sku}</TableCell>
                    <TableCell>{qty}</TableCell>
                    <TableCell>{order.customer}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(line?.status || order.status)}>{line?.status || order.status}</Badge>
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItemsOrder(order)}
                      >
                        <Eye className="mr-1 h-3 w-3" />
                        View items
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </Modal>

      <Modal
        open={!!itemsOrder}
        onOpenChange={(openState) => { if (!openState) setItemsOrder(null); }}
        title={itemsOrder ? `Items · ${itemsOrder.id}` : 'Items'}
        description={itemsOrder ? `${itemsOrder.customer} · ${itemsOrder.address || itemsOrder.city || ''}` : ''}
        className="max-w-2xl"
        footer={<Button onClick={() => setItemsOrder(null)}>Close</Button>}
      >
        {itemsOrder && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Sub-order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(itemsOrder.subOrders || []).map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ProductThumb name={sub.title} src={sub.imageUrl} />
                      <span>{sub.title}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{sub.sku}</TableCell>
                  <TableCell>{sub.qty}</TableCell>
                  <TableCell className="font-medium">{sub.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Modal>

      <Modal
        open={open}
        onOpenChange={(isOpen) => { if (!isOpen) closeVendor(); else setOpen(true); }}
        title={confirmDelete ? 'Delete vendor' : editing ? 'Edit Vendor' : 'Add Vendor'}
        description={confirmDelete
          ? `${editing?.name || 'This vendor'} will be removed from the vendor list. Orders already assigned to them stay on those orders.`
          : 'Phone numbers are not unique — the same number can belong to more than one vendor.'}
        footer={
          confirmDelete ? (
            <>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep vendor</Button>
              <Button variant="destructive" onClick={deleteVendor}>Delete vendor</Button>
            </>
          ) : (
            <>
              {editing && (
                <Button variant="destructive" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={closeVendor}>Cancel</Button>
              <Button loading={saving} onClick={saveVendor}>{editing ? 'Save changes' : 'Save Vendor'}</Button>
            </>
          )
        }
      >
        <div className="space-y-3">
          {confirmDelete && editing?.assignedOrders > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {editing.assignedOrders === 1
                ? '1 assigned order stays on the order list.'
                : `${editing.assignedOrders} assigned orders stay on the order list.`}
            </p>
          )}
          <div>
            <label className="text-sm font-medium">Vendor name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Phone</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
          </div>
          <div>
            <label className="text-sm font-medium">Location</label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Telegram group</label>
            <Input value={form.telegramGroup} onChange={(e) => setForm({ ...form, telegramGroup: e.target.value })} placeholder="@vendor_group" />
          </div>
          {canSetPassword && !confirmDelete && (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--color-border-premium))] p-3">
              <div>
                <p className="text-sm font-medium">Login password</p>
                <p className="text-xs text-muted-foreground">Super Admin only. Leave blank to keep the current password. The vendor signs in with the email above.</p>
              </div>
              <div>
                <label className="text-sm font-medium">New password</label>
                <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep" />
              </div>
              <div>
                <label className="text-sm font-medium">Confirm password</label>
                <Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat the new password" />
              </div>
              {password ? <PasswordHints value={password} /> : null}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
