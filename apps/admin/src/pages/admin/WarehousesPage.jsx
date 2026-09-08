import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { warehouses as warehouseSeed, inventory } from '../../mocks';
import { formatINR } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import Drawer from '../../components/ui/Drawer';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Building, MapPin, Plus, Box, Package, Search } from 'lucide-react';

const LOCATION_MAP = [
  { channel: 'Shopify Location A (Offline)', warehouse: 'WH-001', usedBy: 'Shopify, Amazon, Myntra' },
  { channel: 'Shopify Location B (Virtual)', warehouse: 'WH-002', usedBy: 'Shopify only' },
  { channel: 'Amazon inventory', warehouse: 'WH-001', usedBy: 'Amazon' },
  { channel: 'Myntra inventory', warehouse: 'WH-001', usedBy: 'Myntra' },
];

const TYPE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'Offline', label: 'Offline' },
  { id: 'Virtual', label: 'Virtual' },
  { id: 'Return Hub', label: 'Return Hub' },
  { id: 'pickup', label: 'Pickup' },
];

const emptyWarehouse = {
  name: '',
  type: 'Offline',
  location: '',
  address: '',
  capacity: '2000',
};

function channelsForType(type) {
  if (type === 'Virtual') return ['Shopify'];
  if (type === 'Offline') return ['Shopify', 'Amazon', 'Myntra'];
  return [];
}

export default function WarehousesPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseList, setWarehouseList] = useState(warehouseSeed);
  const [selectedWarehouses, setSelectedWarehouses] = useState(
    warehouseSeed.filter((w) => w.isPickup).map((w) => w.id)
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyWarehouse);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressForm, setAddressForm] = useState({ line1: '', city: '', pincode: '' });
  const [stockWh, setStockWh] = useState(null);
  const loading = useSimulatedLoad(activeTab);

  const filtered = useMemo(() => warehouseList.filter((wh) => {
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'pickup' ? selectedWarehouses.includes(wh.id) : wh.type === activeTab);
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || wh.name.toLowerCase().includes(q) || wh.id.toLowerCase().includes(q) || wh.location.toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  }), [warehouseList, activeTab, searchQuery, selectedWarehouses]);

  const stockRows = inventory.filter((item) => item.warehouse === stockWh?.id);

  const handleWarehouseToggle = (warehouse) => {
    if (warehouse.type === 'Virtual') {
      toast.error('Virtual stock is not a pickup location');
      return;
    }
    setSelectedWarehouses((prev) =>
      prev.includes(warehouse.id) ? prev.filter((id) => id !== warehouse.id) : [...prev, warehouse.id]
    );
    setWarehouseList((prev) => prev.map((item) => (
      item.id === warehouse.id ? { ...item, isPickup: !selectedWarehouses.includes(warehouse.id) } : item
    )));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyWarehouse);
    setFormOpen(true);
  };

  const openEdit = (warehouse) => {
    setEditing(warehouse);
    setForm({
      name: warehouse.name,
      type: warehouse.type,
      location: warehouse.location,
      address: warehouse.address,
      capacity: String(warehouse.capacity),
    });
    setFormOpen(true);
  };

  const saveWarehouse = () => {
    if (!form.name.trim() || !form.location.trim()) {
      toast.error('Name and location are required');
      return;
    }
    const channels = channelsForType(form.type);
    if (editing) {
      setWarehouseList((prev) => prev.map((item) => (
        item.id === editing.id
          ? {
              ...item,
              ...form,
              capacity: Number(form.capacity) || item.capacity,
              channels,
              isPickup: form.type === 'Virtual' ? false : item.isPickup,
            }
          : item
      )));
      if (form.type === 'Virtual') {
        setSelectedWarehouses((prev) => prev.filter((id) => id !== editing.id));
      }
      toast.success(`${form.name} updated`);
    } else {
      const id = `WH-${String(warehouseList.length + 1).padStart(3, '0')}`;
      setWarehouseList((prev) => [
        ...prev,
        {
          id,
          name: form.name,
          type: form.type,
          location: form.location,
          address: form.address || '—',
          capacity: Number(form.capacity) || 0,
          currentStock: 0,
          channels,
          shopifyLocation: form.type === 'Offline' ? 'Shopify Location A — Offline' : form.type === 'Virtual' ? 'Shopify Location B — Virtual' : '',
          status: 'Active',
          isPickup: false,
        },
      ]);
      toast.success(`${form.name} added`);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const saveAddress = () => {
    if (!addressForm.line1.trim()) {
      toast.error('Enter an address');
      return;
    }
    setWarehouseList((prev) =>
      prev.map((wh) =>
        selectedWarehouses.includes(wh.id)
          ? { ...wh, address: `${addressForm.line1}, ${addressForm.city} ${addressForm.pincode}`.trim() }
          : wh
      )
    );
    toast.success(`Address saved for ${selectedWarehouses.length} pickup warehouse(s)`);
    setAddressOpen(false);
    setAddressForm({ line1: '', city: '', pincode: '' });
  };

  const kpi = {
    total: warehouseList.length,
    offline: warehouseList.filter((w) => w.type === 'Offline').length,
    virtual: warehouseList.filter((w) => w.type === 'Virtual').length,
    pickup: selectedWarehouses.length,
  };

  if (loading) return <PageLoader label="Loading warehouses..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Warehouses</h1>
          <p className="text-muted-foreground">WH-001 Offline serves Shopify, Amazon and Myntra. WH-002 Virtual is Shopify only.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add Warehouse
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total" value={kpi.total} icon={Building} onClick={() => setActiveTab('all')} />
        <KpiCard label="Offline" value={kpi.offline} icon={Box} onClick={() => setActiveTab('Offline')} />
        <KpiCard label="Virtual" value={kpi.virtual} icon={Package} onClick={() => setActiveTab('Virtual')} />
        <KpiCard label="Pickup" value={kpi.pickup} icon={MapPin} onClick={() => setActiveTab('pickup')} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap">
          {TYPE_TABS.map((tab) => (
            <Button key={tab.id} variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search warehouses..."
            className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Channel → Warehouse Mapping</CardTitle>
          <CardDescription>
            Shopify Location A (Offline) is the shared pool with Amazon and Myntra. Shopify Location B
            (Virtual) stays Shopify-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel location</TableHead>
                <TableHead>Internal warehouse</TableHead>
                <TableHead>Sells on</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LOCATION_MAP.map((row) => (
                <TableRow key={row.channel} className="cursor-pointer" onClick={() => setActiveTab(row.warehouse === 'WH-002' ? 'Virtual' : 'Offline')}>
                  <TableCell className="font-medium">{row.channel}</TableCell>
                  <TableCell>{row.warehouse}</TableCell>
                  <TableCell>{row.usedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-primary/50">
        <CardHeader>
          <CardTitle>Pickup Warehouse</CardTitle>
          <CardDescription>
            Tick the warehouse used for pickup and courier labels. Virtual stock is not a pickup location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {warehouseList.map((warehouse) => (
                <label
                  key={warehouse.id}
                  className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${warehouse.type === 'Virtual' ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedWarehouses.includes(warehouse.id)}
                    onChange={() => handleWarehouseToggle(warehouse)}
                    className="w-5 h-5"
                    disabled={warehouse.type === 'Virtual'}
                  />
                  <div>
                    <div className="font-medium">{warehouse.id} · {warehouse.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {warehouse.type} · {warehouse.location}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-4 border-t">
              <Button onClick={() => setAddressOpen(true)} disabled={selectedWarehouses.length === 0}>
                <Plus className="w-4 h-4 mr-2" />
                Add Address
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedWarehouses.length} warehouse(s) selected for pickup
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No warehouses in this view" description="Change the tab or add a warehouse." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((warehouse) => (
            <Card key={warehouse.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building className="w-5 h-5" />
                      {warehouse.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {warehouse.location}
                      </div>
                    </CardDescription>
                  </div>
                  <Badge variant={warehouse.type === 'Offline' ? 'outline' : 'secondary'}>{warehouse.type}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Box className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Stock</p>
                        <p className="font-medium">{warehouse.currentStock}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Capacity</p>
                        <p className="font-medium">{warehouse.capacity}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Sells On</p>
                    <p className="text-sm">
                      {warehouse.channels.length > 0 ? warehouse.channels.join(', ') : 'Not a selling location'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Address</p>
                    <p className="text-sm">{warehouse.address}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(warehouse)}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => setStockWh(warehouse)}>View Stock</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Warehouse Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Sells On</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((warehouse) => (
                <TableRow key={warehouse.id}>
                  <TableCell className="font-medium">{warehouse.id}</TableCell>
                  <TableCell>{warehouse.name}</TableCell>
                  <TableCell>
                    <Badge variant={warehouse.type === 'Offline' ? 'outline' : 'secondary'}>{warehouse.type}</Badge>
                  </TableCell>
                  <TableCell>{warehouse.location}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {warehouse.channels.length > 0 ? warehouse.channels.join(', ') : '—'}
                  </TableCell>
                  <TableCell>{warehouse.currentStock}</TableCell>
                  <TableCell>{warehouse.capacity}</TableCell>
                  <TableCell><Badge variant="outline">{warehouse.status}</Badge></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(warehouse)}>Manage</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Drawer open={!!stockWh} onOpenChange={(open) => !open && setStockWh(null)} title={stockWh ? `${stockWh.id} stock` : 'Stock'} size="lg">
        {stockRows.length === 0 ? (
          <EmptyState title="No SKUs in this warehouse" />
        ) : (
          <div className="space-y-4">
            <Button variant="outline" size="sm" onClick={() => navigate('/inventory')}>Open inventory</Button>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockRows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.sku}</TableCell>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell>{item.available}</TableCell>
                    <TableCell>{formatINR(item.stock * item.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Drawer>

      <Modal
        open={formOpen}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
        title={editing ? 'Edit warehouse' : 'Add warehouse'}
        description="Virtual warehouses stay Shopify-only and cannot be pickup locations."
        footer={
          <>
            <Button variant="outline" onClick={() => { setFormOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={saveWarehouse}>{editing ? 'Save changes' : 'Save warehouse'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="Offline">Offline</option>
              <option value="Virtual">Virtual</option>
              <option value="Return Hub">Return Hub</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Location</label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Address</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Capacity</label>
            <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal
        open={addressOpen}
        onOpenChange={setAddressOpen}
        title="Add pickup address"
        description={`Address will be saved on ${selectedWarehouses.join(', ')}.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAddressOpen(false)}>Cancel</Button>
            <Button onClick={saveAddress}>Save Address</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Address line</label>
            <Input value={addressForm.line1} onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">City</label>
            <Input value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Pincode</label>
            <Input value={addressForm.pincode} onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
