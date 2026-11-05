import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { formatINR, formatDateTime } from '../../utils/format';
import { cn } from '../../lib/utils';
import { cachedPage, rememberPage } from '../../lib/pageCache';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
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
import ProductThumb from '../../components/ui/ProductThumb';
import { FormBanner } from '../../components/ui/FormBanner';
import { Package, AlertTriangle, TrendingUp, Search } from 'lucide-react';
import api, { apiError, apiFormError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { PERMISSIONS } from '../../constants/permissions';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';
import TableToolbar from '../../components/ui/TableToolbar';

const TABS = [
  { id: 'all', label: 'All Stock' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'low', label: 'Low Stock' },
  { id: 'available', label: 'Available' },
  { id: 'ledger', label: 'Movements' },
];

export default function InventoryPage() {
  const navigate = useNavigate();
  const { canInventoryAdjust, can } = usePermissions();
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const connected = useConnectedChannels();
  const seed = cachedPage('inventory');
  const [warehouses, setWarehouses] = useState(cachedPage('warehouses') || []);
  const [masters, setMasters] = useState([]);
  const [mastersLoaded, setMastersLoaded] = useState(false);
  const [rows, setRows] = useState(seed?.rows || []);
  const [kpis, setKpis] = useState(seed?.kpis || { totalStock: 0, reserved: 0, available: 0, stockValue: 0, low: 0 });
  const [ledger, setLedger] = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(seed?.total || 0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [inOpen, setInOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [banner, setBanner] = useState('');
  const [adjust, setAdjust] = useState({ direction: 'in', qty: '10', reason: '' });
  const [stockIn, setStockIn] = useState({ masterSkuId: '', warehouseId: '', qty: '10', reason: 'Opening / receipt' });
  const [reserve, setReserve] = useState({ channel: 'amazon', qty: '1', attempts: '10' });
  const [ats, setAts] = useState(null);
  const [reorderPoint, setReorderPoint] = useState('');
  const [authority, setAuthority] = useState(seed?.authority || 'oms');
  const omsMaster = authority !== 'shopify';

  const loadMasters = async () => {
    try {
      const { data } = await api.get('/master-skus');
      const list = data.data || [];
      setMasters(list);
      setMastersLoaded(true);
      setStockIn((current) => (current.masterSkuId ? current : { ...current, masterSkuId: list[0]?.id || '' }));
    } catch (err) {
      toast.error(apiError(err, 'Could not load Master SKUs'));
    }
  };

  const loadWarehouses = async () => {
    try {
      const { data } = await api.get('/warehouses');
      setWarehouses(rememberPage('warehouses', data.data?.warehouses || []));
    } catch (err) {
      toast.error(apiError(err, 'Could not load warehouses'));
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [inv, led] = await Promise.all([
        api.get('/inventory', { params: { warehouseId: warehouseId || undefined, q: q || undefined, tab: tab === 'ledger' ? 'all' : tab, sort: sort || undefined, page, limit: PAGE_SIZE } }),
        tab === 'ledger' ? api.get('/inventory/ledger', { params: { page: ledgerPage, limit: PAGE_SIZE } }) : Promise.resolve({ data: { data: [], meta: { total: 0 } } }),
      ]);
      const nextRows = inv.data.data?.rows || [];
      setRows(nextRows);
      setSelected((current) => {
        if (!current) return null;
        return nextRows.find((row) => row.masterSkuId === current.masterSkuId && row.warehouseId === current.warehouseId) || null;
      });
      setTotal(inv.data.meta?.total || nextRows.length);
      setKpis(inv.data.data?.kpis || kpis);
      setAuthority(inv.data.data?.inventoryAuthority || 'oms');
      if (!warehouseId && tab === 'all' && !q && !sort && page === 1) rememberPage('inventory', {
        rows: nextRows, total: inv.data.meta?.total || nextRows.length, kpis: inv.data.data?.kpis || kpis, authority: inv.data.data?.inventoryAuthority || 'oms',
      });
      setLedger(led.data.data || []);
      setLedgerTotal(led.data.meta?.total || (led.data.data || []).length);
    } catch (err) {
      toast.error(apiError(err, 'Could not load inventory'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWarehouses(); }, []);

  useEffect(() => { load(); }, [warehouseId, tab, sort, page, ledgerPage]);

  useEffect(() => {
    if (inOpen && !mastersLoaded) loadMasters();
  }, [inOpen]);

  useEffect(() => {
    if (!selected) {
      setAts(null);
      return;
    }
    setReorderPoint(String(selected.reorderPoint ?? 10));
    api.get('/inventory/ats', { params: { masterSkuId: selected.masterSkuId } })
      .then(({ data }) => setAts(data.data))
      .catch(() => setAts(null));
  }, [selected?.id, selected?.masterSkuId]);

  const postAdjust = async () => {
    setBanner('');
    try {
      await api.post('/inventory/adjust', {
        masterSkuId: selected.masterSkuId,
        warehouseId: selected.warehouseId,
        qty: Number(adjust.qty),
        direction: adjust.direction,
        reason: adjust.reason || (adjust.direction === 'out' ? 'Stock out' : 'Stock in'),
      });
      toast.success('Ledger row posted');
      setAdjustOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const postStockIn = async () => {
    setBanner('');
    try {
      await api.post('/inventory/stock-in', {
        masterSkuId: stockIn.masterSkuId,
        warehouseId: stockIn.warehouseId,
        qty: Number(stockIn.qty),
        reason: stockIn.reason,
      });
      toast.success('Stock in posted');
      setInOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const runReserve = async () => {
    setBanner('');
    try {
      const { data } = await api.post('/inventory/reserve', {
        masterSkuId: selected.masterSkuId,
        channel: reserve.channel,
        qty: Number(reserve.qty),
        reason: 'Manual / test reserve',
      });
      toast.success(data.message || 'Reserved');
      setReserveOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  const runShopifyImport = async () => {
    setImporting(true);
    try {
      await api.post('/integrations/jobs', { channel: 'shopify', jobType: 'stock_import' });
      toast.success('Shopify stock import started. It runs in the background; the result shows on Integrations.');
      setImportOpen(false);
    } catch (err) {
      toast.error(apiError(err, 'Could not start the Shopify stock import'));
    } finally {
      setImporting(false);
    }
  };

  const runStress = async () => {
    setBanner('');
    try {
      const { data } = await api.post('/inventory/stress-test', {
        masterSkuId: selected.masterSkuId,
        channel: reserve.channel,
        qty: 1,
        attempts: Number(reserve.attempts) || 10,
      });
      toast.success(data.message || 'Stress finished');
      setReserveOpen(false);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  if (loading && rows.length === 0 && tab !== 'ledger') return <PageLoader label="Loading inventory..." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Inventory</h1>
          <p className="text-xs text-muted-foreground">
            WH-001 sells on every channel. WH-002 is Shopify only. Available = on hand minus reserved. ATS = available to sell on that channel. Stock in writes a ledger row.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(PERMISSIONS.SETTINGS_MANAGE) && omsMaster && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>Import stock from Shopify</Button>
          )}
          {canInventoryAdjust && omsMaster && (
            <Button onClick={() => {
              setStockIn({
                masterSkuId: masters[0]?.id || '',
                warehouseId: warehouses[0]?.id || '',
                qty: '10',
                reason: 'Opening / receipt',
              });
              setBanner('');
              setInOpen(true);
            }}
            >
              Stock in
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate('/warehouses')}>Warehouses</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="On hand" value={kpis.totalStock} icon={Package} onClick={() => { setTab('all'); setPage(1); }} />
        <KpiCard label="Reserved" value={kpis.reserved} icon={Package} onClick={() => { setTab('reserved'); setPage(1); }} />
        <KpiCard label="Available" value={kpis.available} icon={Package} onClick={() => { setTab('available'); setPage(1); }} />
        <KpiCard label="Low Stock" value={kpis.low} icon={AlertTriangle} onClick={() => { setTab('low'); setPage(1); }} />
        <KpiCard label="Stock Value" value={formatINR(kpis.stockValue)} icon={TrendingUp} />
      </div>

      <TableToolbar
        search={(
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="SKU or product"
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={load}>Search</Button>
            {tab !== 'ledger' && (
              <Select className="w-auto" aria-label="Sort by" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                <option value="">Sort: SKU</option>
                <option value="qty_desc">Qty: high to low</option>
                <option value="qty_asc">Qty: low to high</option>
              </Select>
            )}
          </div>
        )}
        filters={(
          <div className="space-y-2">
            <div className="flex gap-2 overflow-x-auto">
              <Button variant={!warehouseId ? 'default' : 'outline'} size="sm" className="whitespace-nowrap" onClick={() => { setWarehouseId(''); setPage(1); }}>All warehouses</Button>
              {warehouses.map((wh) => (
                <Button key={wh.id} variant={warehouseId === wh.id ? 'default' : 'outline'} size="sm" className="whitespace-nowrap" onClick={() => { setWarehouseId(wh.id); setPage(1); }}>
                  {wh.code}
                </Button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {TABS.map((item) => (
                <Button key={item.id} variant={tab === item.id ? 'default' : 'outline'} size="sm" className="whitespace-nowrap" onClick={() => { setTab(item.id); setPage(1); setLedgerPage(1); }}>
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'ledger' ? `Immutable movements (${ledgerTotal})` : `Stock by SKU (${total})`}</CardTitle>
        </CardHeader>
        <CardContent aria-busy={loading} className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')}>
          {tab === 'ledger' ? (
            ledger.length === 0 ? <EmptyState title="No movements yet" description="Stock in or reserve to write the ledger." /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>WH</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>On hand after</TableHead>
                    <TableHead>Available after</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Channel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{row.at ? formatDateTime(row.at) : '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProductThumb name={row.productName || row.sku} sku={row.sku} src={row.imageUrl} />
                          <span className="font-medium">{row.sku}</span>
                        </div>
                      </TableCell>
                      <TableCell>{row.warehouse}</TableCell>
                      <TableCell>{row.qty}</TableCell>
                      <TableCell>{row.after}</TableCell>
                      <TableCell>{row.availableAfter}</TableCell>
                      <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                      <TableCell className="text-sm">{row.reason}</TableCell>
                      <TableCell>{row.channel || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              title={tab === 'all' ? 'No Master SKUs' : 'Nothing in this view'}
              description={tab === 'all'
                ? 'Create a Master SKU first. Stock then appears here at WH-001 and WH-002 with zero on hand until you post a receipt.'
                : 'This filter only shows rows that already have reserved, available, or low stock.'}
              action={tab === 'all' && canInventoryAdjust && omsMaster && <Button onClick={() => setInOpen(true)}>Stock in</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Visible on</TableHead>
                  <TableHead>On hand</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  {connected.channels.map((channel) => <TableHead key={channel.id} title={`Available to sell on ${orderChannelLabel(channel)}`}>{orderChannelLabel(channel)} ATS</TableHead>)}
                  <TableHead>Status</TableHead>
                  {canInventoryAdjust && omsMaster && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelected(item)}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <ProductThumb name={item.productName || item.sku} sku={item.sku} src={item.imageUrl} />
                        <div>
                          <div>{item.shopifySku || item.sku}</div>
                          {item.shopifySku && item.shopifySku !== item.sku && (
                            <div className="text-xs font-normal text-muted-foreground">Master {item.sku}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left text-primary hover:underline"
                        onClick={(event) => { event.stopPropagation(); navigate(`/inventory/sku/${item.masterSkuId}`); }}
                      >{item.productName}</button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.warehouse}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{item.warehouseType}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.channels.join(', ') || '—'}</TableCell>
                    <TableCell>{item.stock}</TableCell>
                    <TableCell>{item.reserved}</TableCell>
                    <TableCell className="font-medium">{item.available}</TableCell>
                    {connected.channels.map((channel) => <TableCell key={channel.id}>{item.ats?.[channel.id] ?? 0}</TableCell>)}
                    <TableCell>
                      {!item.tracked ? (
                        <Badge variant="outline">Not received</Badge>
                      ) : item.low ? (
                        <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Low (≤{item.reorderPoint})</Badge>
                      ) : (
                        <Badge variant="outline">In stock</Badge>
                      )}
                    </TableCell>
                    {canInventoryAdjust && omsMaster && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => { setSelected(item); setAdjust({ direction: 'in', qty: '10', reason: '' }); setBanner(''); setAdjustOpen(true); }}>
                          Adjust
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {tab === 'ledger'
            ? <Pagination page={ledgerPage} total={ledgerTotal} limit={PAGE_SIZE} onPage={setLedgerPage} />
            : <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />}
        </CardContent>
      </Card>

      <Drawer open={!!selected && !adjustOpen && !reserveOpen} onOpenChange={(open) => !open && setSelected(null)} title={selected ? selected.sku : 'SKU'}>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <ProductThumb name={selected.productName || selected.sku} sku={selected.sku} src={selected.imageUrl} size="lg" />
              <p className="text-lg font-semibold">{selected.productName}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate(`/inventory/sku/${selected.masterSkuId}`)}>Open product page</Button>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-muted-foreground">Warehouse</p><p className="font-medium">{selected.warehouse} · {selected.warehouseType}</p></div>
              <div><p className="text-muted-foreground">Available</p><p className="font-medium">{selected.available}</p></div>
              <div><p className="text-muted-foreground">On hand</p><p>{selected.stock}</p></div>
              <div><p className="text-muted-foreground">Reserved</p><p>{selected.reserved}</p></div>
            </div>
            {ats && (
              <div>
                <p className="text-muted-foreground mb-1">ATS (available to sell) for this Master SKU</p>
                <p>{connected.channels.map((channel) => `${orderChannelLabel(channel)} ${ats[channel.id] ?? 0}`).join(' · ')}</p>
              </div>
            )}
            {canInventoryAdjust && omsMaster && (
              <div className="space-y-2">
                <label className="text-muted-foreground">Low-stock threshold</label>
                <div className="flex gap-2">
                  <Input type="number" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await api.patch(`/inventory/${selected.id}/threshold`, { reorderPoint: Number(reorderPoint) });
                        toast.success('Reorder point saved');
                        load();
                      } catch (err) {
                        toast.error(apiError(err, 'Could not save threshold'));
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { setAdjust({ direction: 'in', qty: '10', reason: '' }); setBanner(''); setAdjustOpen(true); }}>Adjust</Button>
                  <Button variant="outline" onClick={() => { setReserve({ channel: 'amazon', qty: '1', attempts: '10' }); setBanner(''); setReserveOpen(true); }}>Reserve / stress</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        title="Stock in / out"
        description={selected ? `${selected.sku} at ${selected.warehouse}` : ''}
        footer={(
          <>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button onClick={postAdjust}>Post to ledger</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not post">{banner}</FormBanner>}
          <Select value={adjust.direction} onChange={(e) => setAdjust({ ...adjust, direction: e.target.value })}>
            <option value="in">Stock in</option>
            <option value="out">Stock out</option>
          </Select>
          <Input type="number" min="1" value={adjust.qty} onChange={(e) => setAdjust({ ...adjust, qty: e.target.value })} />
          <Input placeholder="Reason" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import stock from Shopify"
        description="One-time opening stock. Shopify is only read; nothing is changed on Shopify."
        footer={(
          <>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button disabled={importing} onClick={runShopifyImport}>{importing ? 'Starting…' : 'Start import'}</Button>
          </>
        )}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>On-hand qty at each linked Shopify location is added to its warehouse (Offline Shop → WH-001, Virtual Warehouse → WH-002).</li>
          <li>SKUs that already have stock in OMS are left as they are. Running it again does not add stock twice.</li>
          <li>Each SKU gets an “Opening stock from Shopify” row on Movements. No low stock alerts are sent.</li>
        </ul>
      </Modal>

      <Modal
        open={inOpen}
        onOpenChange={setInOpen}
        title="Stock in"
        description="Creates the inventory row if this SKU has never been received in that warehouse."
        footer={(
          <>
            <Button variant="outline" onClick={() => setInOpen(false)}>Cancel</Button>
            <Button onClick={postStockIn}>Post stock in</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not post">{banner}</FormBanner>}
          <Select value={stockIn.masterSkuId} onChange={(e) => setStockIn({ ...stockIn, masterSkuId: e.target.value })}>
            <option value="">{inOpen && !mastersLoaded ? 'Loading Master SKUs…' : 'Master SKU'}</option>
            {masters.map((sku) => <option key={sku.id} value={sku.id}>{sku.code} — {sku.name}</option>)}
          </Select>
          <Select value={stockIn.warehouseId} onChange={(e) => setStockIn({ ...stockIn, warehouseId: e.target.value })}>
            <option value="">Warehouse</option>
            {warehouses.map((wh) => <option key={wh.id} value={wh.id}>{wh.code} ({wh.type})</option>)}
          </Select>
          <Input type="number" min="1" value={stockIn.qty} onChange={(e) => setStockIn({ ...stockIn, qty: e.target.value })} />
          <Input placeholder="Reason" value={stockIn.reason} onChange={(e) => setStockIn({ ...stockIn, reason: e.target.value })} />
        </div>
      </Modal>

      <Modal
        open={reserveOpen}
        onOpenChange={setReserveOpen}
        title="Reserve / concurrent test"
        description="Holds available qty as if an order landed. Stress fires many reserves at once — only available units succeed."
        footer={(
          <>
            <Button variant="outline" onClick={() => setReserveOpen(false)}>Close</Button>
            <Button variant="outline" onClick={runStress}>Stress 10 orders</Button>
            <Button onClick={runReserve}>Reserve</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not reserve">{banner}</FormBanner>}
          <Select value={reserve.channel} onChange={(e) => setReserve({ ...reserve, channel: e.target.value })}>
            {connected.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {orderChannelLabel(channel)}{channel.id === 'shopify' ? ' (WH-001 then WH-002)' : ' (WH-001 only)'}
              </option>
            ))}
          </Select>
          <Input type="number" min="1" value={reserve.qty} onChange={(e) => setReserve({ ...reserve, qty: e.target.value })} />
          <Input type="number" min="2" max="50" value={reserve.attempts} onChange={(e) => setReserve({ ...reserve, attempts: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
