import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendors as vendorSeed, orders } from '../../mocks';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import Drawer from '../../components/ui/Drawer';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Store, Plus, MessageCircle, Star, MapPin, Package, Search } from 'lucide-react';

const emptyVendor = { name: '', location: '', phone: '', email: '', telegramGroup: '' };

export default function VendorsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [vendorList, setVendorList] = useState(vendorSeed);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyVendor);
  const [searchQuery, setSearchQuery] = useState('');
  const [ordersVendor, setOrdersVendor] = useState(null);
  const loading = useSimulatedLoad(activeTab);

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

  const vendorOrders = orders.filter((order) => order.assignedVendor === ordersVendor?.name);

  const sharedPhone = (phone, skipId) =>
    vendorList.filter((v) => v.id !== skipId && v.phone.replace(/\s/g, '') === phone.replace(/\s/g, '')).map((v) => v.name);

  const saveVendor = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    if (editing) {
      setVendorList((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...form } : item)));
      toast.success(`${form.name} updated`);
    } else {
      const others = sharedPhone(form.phone);
      setVendorList((prev) => [
        {
          id: `VND-${String(prev.length + 1).padStart(3, '0')}`,
          ...form,
          location: form.location || '—',
          assignedOrders: 0,
          rating: 0,
          status: 'Active',
        },
        ...prev,
      ]);
      toast.success(others.length ? `${form.name} added. Same phone already used by ${others.join(', ')}.` : `${form.name} added`);
    }
    setForm(emptyVendor);
    setEditing(null);
    setOpen(false);
  };

  const toggleStatus = (vendor) => {
    const next = vendor.status === 'Active' ? 'Inactive' : 'Active';
    setVendorList((prev) => prev.map((item) => (item.id === vendor.id ? { ...item, status: next } : item)));
    toast.success(`${vendor.name} marked ${next}`);
  };

  const openEdit = (vendor) => {
    setEditing(vendor);
    setForm({
      name: vendor.name,
      location: vendor.location,
      phone: vendor.phone,
      email: vendor.email || '',
      telegramGroup: vendor.telegramGroup || '',
    });
    setOpen(true);
  };

  if (loading) return <PageLoader label="Loading vendors..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Vendors</h1>
          <p className="text-muted-foreground">Accept / reject, dispatch, bulk AWB. Same phone number can exist on more than one vendor.</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm(emptyVendor); setOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Vendor
        </Button>
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

      {filtered.length === 0 ? (
        <EmptyState title="No vendors in this view" description="Add a vendor or clear search." />
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
                      <p className="text-sm font-medium">{vendor.phone}</p>
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
          <CardDescription>The same phone number can be used on more than one vendor.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Assigned Orders</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Telegram Group</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>{vendor.location}</TableCell>
                  <TableCell>{vendor.phone}</TableCell>
                  <TableCell>{vendor.assignedOrders}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      <span>{vendor.rating}</span>
                    </div>
                  </TableCell>
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Drawer open={!!ordersVendor} onOpenChange={(openState) => !openState && setOrdersVendor(null)} title={ordersVendor ? `${ordersVendor.name} orders` : 'Orders'} size="lg">
        {vendorOrders.length === 0 ? (
          <EmptyState title="No assigned orders yet" description="Fulfilment assignments will show here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.id}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell>{formatINR(order.total)}</TableCell>
                  <TableCell><Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Drawer>

      <Modal
        open={open}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setEditing(null); }}
        title={editing ? 'Edit Vendor' : 'Add Vendor'}
        description="Phone numbers are not unique — the same number can belong to more than one vendor."
        footer={
          <>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={saveVendor}>{editing ? 'Save changes' : 'Save Vendor'}</Button>
          </>
        }
      >
        <div className="space-y-3">
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
        </div>
      </Modal>
    </div>
  );
}
