import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { inventory as inventorySeed, warehouses } from '../../mocks';
import { formatINR } from '../../utils/format';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import Drawer from '../../components/ui/Drawer';
import Modal from '../../components/ui/Modal';
import { Warehouse, Package, AlertTriangle, TrendingUp, Search, RefreshCw, Download } from 'lucide-react';

const STATUS_TABS = [
  { id: 'all', label: 'All Stock' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'low', label: 'Low Stock' },
  { id: 'normal', label: 'Available' },
  { id: 'ledger', label: 'Movements' },
];

const LEDGER = [
  { id: 'LED-01', sku: 'LHK-BL-001', warehouse: 'WH-001', qty: -2, before: 47, after: 45, type: 'reserve', reason: 'Order 65207-LEH', channel: 'Shopify', actor: 'system', at: '2026-08-25 10:30' },
  { id: 'LED-02', sku: 'LHK-BL-001', warehouse: 'WH-001', qty: -2, before: 45, after: 43, type: 'ship', reason: 'AWB DLV123', channel: 'Shopify', actor: 'ops@leheriya.com', at: '2026-08-25 16:12' },
  { id: 'LED-03', sku: 'CSS-PK-002', warehouse: 'WH-002', qty: 1000, before: 0, after: 1000, type: 'adjust', reason: 'Virtual listing', channel: 'Shopify', actor: 'superadmin', at: '2026-08-01 09:00' },
];

export default function InventoryPage() {
  const navigate = useNavigate();
  const [activeWarehouse, setActiveWarehouse] = useState('all');
  const [statusTab, setStatusTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockList, setStockList] = useState(inventorySeed);
  const [selected, setSelected] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustQty, setAdjustQty] = useState('10');
  const [adjustType, setAdjustType] = useState('add');
  const [syncing, setSyncing] = useState(false);
  const loading = useSimulatedLoad(`${activeWarehouse}-${statusTab}`);

  const isLow = (item) => item.available < 10;

  const filteredInventory = useMemo(() => stockList.filter((item) => {
    const matchesWarehouse = activeWarehouse === 'all' || item.warehouse === activeWarehouse;
    const matchesStatus =
      statusTab === 'all' ||
      statusTab === 'ledger' ||
      (statusTab === 'low' ? isLow(item) : statusTab === 'reserved' ? item.reserved > 0 : !isLow(item));
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      item.sku.toLowerCase().includes(q) ||
      item.productName.toLowerCase().includes(q);
    return matchesWarehouse && matchesStatus && matchesSearch;
  }), [stockList, activeWarehouse, statusTab, searchQuery]);

  const scoped = activeWarehouse === 'all' ? stockList : stockList.filter((item) => item.warehouse === activeWarehouse);
  const kpiData = {
    totalStock: scoped.reduce((sum, item) => sum + item.stock, 0),
    reserved: scoped.reduce((sum, item) => sum + item.reserved, 0),
    available: scoped.reduce((sum, item) => sum + item.available, 0),
    stockValue: scoped.reduce((sum, item) => sum + item.stock * item.cost, 0),
    low: scoped.filter(isLow).length,
  };

  const applyAdjust = () => {
    if (!selected) return;
    const qty = Number(adjustQty);
    if (!qty || qty < 1) {
      toast.error('Enter a valid quantity');
      return;
    }
    const delta = adjustType === 'add' ? qty : -qty;
    setStockList((prev) => prev.map((item) => {
      if (item.id !== selected.id) return item;
      const stock = Math.max(0, item.stock + delta);
      const reserved = Math.min(item.reserved, stock);
      return { ...item, stock, available: Math.max(0, stock - reserved) };
    }));
    toast.success(`${selected.sku} ${adjustType === 'add' ? 'increased' : 'decreased'} by ${qty}`);
    setAdjustOpen(false);
    setSelected(null);
  };

  const syncStock = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      toast.success('Stock synced from Shopify, Amazon and Myntra');
    }, 700);
  };

  if (loading) return <PageLoader label="Loading inventory..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold mb-2">Inventory</h1>
          <p className="text-muted-foreground">WH-001 (offline, all channels) and WH-002 (virtual, Shopify). Ledger, not one overwritten qty.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={syncStock} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Stock'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => toast.success(`Exported ${filteredInventory.length} SKUs`)}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Warehouse className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Channel Visibility Rule</p>
              <p className="text-sm text-muted-foreground">
                Offline warehouse stock is sellable on Shopify, Amazon and Myntra.
                Virtual warehouse stock is shown on Shopify only — Amazon and Myntra
                may only list goods that are physically in hand.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Total Stock" value={kpiData.totalStock} icon={Package} onClick={() => setStatusTab('all')} />
        <KpiCard label="Reserved" value={kpiData.reserved} icon={Package} onClick={() => setStatusTab('reserved')} />
        <KpiCard label="Available" value={kpiData.available} icon={Package} onClick={() => setStatusTab('normal')} />
        <KpiCard label="Low Stock" value={kpiData.low} icon={AlertTriangle} onClick={() => setStatusTab('low')} />
        <KpiCard label="Stock Value" value={formatINR(kpiData.stockValue)} icon={TrendingUp} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={activeWarehouse === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveWarehouse('all')}>
          All Warehouses
        </Button>
        {warehouses.map((wh) => (
          <Button
            key={wh.id}
            variant={activeWarehouse === wh.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveWarehouse(wh.id)}
          >
            {wh.id}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => navigate('/warehouses')}>Manage warehouses</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.id} variant={statusTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => setStatusTab(tab.id)}>
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search SKU or product..."
            className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{statusTab === 'ledger' ? 'Immutable movements' : `Stock by SKU (${filteredInventory.length})`}</CardTitle>
        </CardHeader>
        <CardContent>
          {statusTab === 'ledger' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Id</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>WH</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Before → after</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {LEDGER.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.id}</TableCell>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell>{row.warehouse}</TableCell>
                    <TableCell>{row.qty}</TableCell>
                    <TableCell>{row.before} → {row.after}</TableCell>
                    <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell className="text-xs">{row.actor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : filteredInventory.length === 0 ? (
            <EmptyState
              icon={<Package className="h-7 w-7 text-muted-foreground" />}
              title="No stock in this view"
              description="Change warehouse, status, or search."
              action={<Button variant="outline" onClick={() => { setActiveWarehouse('all'); setStatusTab('all'); setSearchQuery(''); }}>Reset</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Visible On</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventory.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
                    <TableCell className="font-medium">{item.sku}</TableCell>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.warehouse}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{item.warehouseType}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {warehouses.find((wh) => wh.id === item.warehouse)?.channels.join(', ') || '—'}
                    </TableCell>
                    <TableCell>{item.stock}</TableCell>
                    <TableCell>{item.reserved}</TableCell>
                    <TableCell className="font-medium">{item.available}</TableCell>
                    <TableCell>{formatINR(item.cost)}</TableCell>
                    <TableCell>
                      {isLow(item) ? (
                        <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Low Stock</Badge>
                      ) : (
                        <Badge variant="outline">Normal</Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => { setSelected(item); setAdjustQty('10'); setAdjustType('add'); setAdjustOpen(true); }}>
                        Adjust
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Drawer open={!!selected && !adjustOpen} onOpenChange={(open) => !open && setSelected(null)} title={selected ? selected.sku : 'SKU'}>
        {selected && (
          <div className="space-y-4 text-sm">
            <p className="text-lg font-semibold">{selected.productName}</p>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-muted-foreground">Warehouse</p><p className="font-medium">{selected.warehouse} · {selected.warehouseType}</p></div>
              <div><p className="text-muted-foreground">Available</p><p className="font-medium">{selected.available}</p></div>
              <div><p className="text-muted-foreground">On hand</p><p>{selected.stock}</p></div>
              <div><p className="text-muted-foreground">Reserved</p><p>{selected.reserved}</p></div>
            </div>
            <p className="text-muted-foreground">
              Visible on {warehouses.find((wh) => wh.id === selected.warehouse)?.channels.join(', ') || 'no selling channel'}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => { setAdjustQty('10'); setAdjustType('add'); setAdjustOpen(true); }}>Adjust stock</Button>
              <Button variant="outline" onClick={() => navigate('/warehouses')}>Open warehouse</Button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={adjustOpen}
        onOpenChange={(open) => { setAdjustOpen(open); if (!open && selected) { /* keep selected for drawer */ } }}
        title="Adjust stock"
        description={selected ? `${selected.sku} at ${selected.warehouse}` : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={applyAdjust}>Save adjustment</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select value={adjustType} onChange={(e) => setAdjustType(e.target.value)}>
            <option value="add">Add stock</option>
            <option value="remove">Remove stock</option>
          </Select>
          <Input type="number" min="1" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
