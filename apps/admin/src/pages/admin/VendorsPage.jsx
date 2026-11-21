import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useVendorStore from '../../stores/vendorStore';
import useOrderStore from '../../stores/orderStore';
import { ordersForVendor } from '../../lib/orderSubOrders';
import { sharedContactWarning, VENDOR_RENAME_NOTE } from '../../lib/vendorContacts';
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
import { Store, Plus, MessageCircle, Package, Search, Trash2, RefreshCw, Eye, AlertTriangle, Phone, MapPin } from 'lucide-react';

const emptyVendor = { name: '', location: '', phone: '', email: '', telegramGroup: '', shopifyVendors: '' };

function passwordProblem(password, confirm) {
  if (!password && !confirm) return '';
  if (password !== confirm) return 'Password and confirm password do not match';
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password needs 12 characters, an uppercase letter, a lowercase letter, a number, and a special character';
  }
  return '';
}

export default function VendorsPage() {
  const navigate = useNavigate();
  const { effectiveRole, user } = useAuth();
  const canSetPassword = effectiveRole === ROLES.SUPER_ADMIN;
  const [activeTab, setActiveTab] = useState('all');
  const allVendors = useVendorStore((s) => s.vendors);
  const autoAssign = useVendorStore((s) => Boolean(user?.tenantId && s.autoAssignByTenant?.[user.tenantId]));
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

  const warnShared = (saved) => {
    const warning = sharedContactWarning(saved?.sharedContacts);
    if (warning) toast(warning, { icon: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />, duration: 6000 });
  };

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
        const saved = await saveVendorRecord(form, editing.id);
        if (canSetPassword && password) {
          await api.post(`/vendors/${editing.id}/password`, { password });
          toast.success(`${form.name} updated. Login password saved for ${form.email.trim()}`);
        } else {
          toast.success(`${form.name} updated`);
        }
        warnShared(saved);
      } else {
        const created = await saveVendorRecord(form);
        if (canSetPassword && password && created?.id) {
          await api.post(`/vendors/${created.id}/password`, { password });
        }
        toast.success(`${form.name} added`);
        warnShared(created);
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
      shopifyVendors: (vendor.shopifyVendors || []).join(', '),
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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Accept / reject, dispatch, bulk AWB. Same phone can belong to more than one vendor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={pulling} onClick={pullShopify}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Fetch from Shopify
          </Button>
          <Button onClick={() => { setEditing(null); setConfirmDelete(false); setPassword(''); setConfirmPassword(''); setForm(emptyVendor); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor
          </Button>
        </div>
      </div>

      {!loaded ? (
        <PageLoader label="Loading vendors..." />
      ) : (
        <>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-gradient-to-r from-emerald-500/[0.06] via-transparent to-transparent px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Auto assignment</p>
          <p className="text-xs text-muted-foreground sm:text-sm">
            When on, Assignment picks the Shopify vendor name automatically if that vendor is still on this list.
          </p>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total Vendors" value={kpiData.total} icon={Store} tone="emerald" onClick={() => setActiveTab('all')} />
        <KpiCard label="Active" value={kpiData.active} icon={Store} tone="sky" onClick={() => setActiveTab('Active')} />
        <KpiCard label="Inactive" value={kpiData.inactive} icon={Store} tone="slate" onClick={() => setActiveTab('Inactive')} />
        <KpiCard label="Assigned orders" value={kpiData.totalOrders} icon={Package} tone="amber" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="gap-3 space-y-0 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Vendor list</CardTitle>
            <CardDescription>
              One list only. Removing a vendor hides them here; their name stays on reports.
            </CardDescription>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {['all', 'Active', 'Inactive'].map((tab) => (
                <Button key={tab} variant={activeTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab)}>
                  {tab === 'all' ? 'All' : tab}
                </Button>
              ))}
            </div>
            <div className="relative min-w-0 sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vendors..."
                className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadError && (
            <p className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{loadError}</p>
          )}

          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={vendorList.length ? 'No vendors in this view' : 'No vendors yet'}
                description={vendorList.length ? 'Clear search or change the tab.' : 'Add a vendor or fetch vendor names from Shopify. Assignment can only assign saved vendors.'}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Vendor</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Telegram</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell>
                      <div className="flex min-w-[10rem] items-start gap-3">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          <Store className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold leading-tight">{vendor.name}</span>
                            {vendor.source === 'shopify' && <Badge variant="outline">Shopify</Badge>}
                          </div>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{vendor.location || 'No location'}</span>
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="flex items-center gap-1.5 text-sm">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        {vendor.phone || '—'}
                      </p>
                      {vendor.email ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{vendor.email}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="inline-flex min-w-[2.5rem] justify-end text-sm font-bold tabular-nums text-primary hover:underline"
                        onClick={() => setOrdersVendor(vendor)}
                      >
                        {vendor.assignedOrders}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={vendor.status === 'Active' ? 'default' : 'secondary'}>{vendor.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {vendor.telegramGroup ? (
                        <Badge variant="outline" className="gap-1">
                          <MessageCircle className="h-3 w-3" />
                          Connected
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not connected</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setOrdersVendor(vendor)}>
                          Orders
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(vendor)}>
                          Manage
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleStatus(vendor)}>
                          {vendor.status === 'Active' ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => { openEdit(vendor); setConfirmDelete(true); }}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
          <EmptyState title="No assigned orders yet" description="Assignments will show here." />
        ) : (
          <div className="overflow-x-auto">
          <Table>
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
                        <ProductThumb name={title} sku={sku} src={photo} />
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
                      <ProductThumb name={sub.title} sku={sub.sku} src={sub.imageUrl} />
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
          : 'Phone and email are not unique — more than one vendor can use the same one. You get a warning when you save.'}
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
            {editing && <p className="text-xs text-muted-foreground">{VENDOR_RENAME_NOTE}</p>}
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
            <label className="text-sm font-medium">Telegram group chat id</label>
            <Input value={form.telegramGroup} onChange={(e) => setForm({ ...form, telegramGroup: e.target.value })} placeholder="-1001234567890 or @vendor_group" />
            <p className="text-xs text-muted-foreground">The bot must already be in this group. Vendor assign sends the order id, SKU, qty, and ship-by date here.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Shopify vendor names</label>
            <Input value={form.shopifyVendors} onChange={(e) => setForm({ ...form, shopifyVendors: e.target.value })} placeholder="Leheriya Jaipur, JP Studio" />
            <p className="text-xs text-muted-foreground">Comma separated. Orders with these Shopify vendors show this vendor in the order&apos;s vendor dropdown. You can still change it before Assign.</p>
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
      </Modal>        </>
      )}
    </div>
  );
}
