import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import ProductThumb from '../../components/ui/ProductThumb';
import { GitCompare, Link, Search, Unlink } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

import useConnectedChannels from '../../hooks/useConnectedChannels';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';

export default function SkuMappingPage() {
  const connected = useConnectedChannels();
  const channels = connected.ids;
  const navigate = useNavigate();
  const { canCatalogEdit } = usePermissions();
  const [activeTab, setActiveTab] = useState('mapped');
  const [channel, setChannel] = useState('');
  const [unlistedChannel, setUnlistedChannel] = useState('amazon');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [masters, setMasters] = useState([]);
  const [counts, setCounts] = useState({ mapped: 0, unmapped: 0, failed: 0, unlisted: 0 });
  const [mappingInput, setMappingInput] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [masterPage, setMasterPage] = useState(1);
  const [masterTotal, setMasterTotal] = useState(0);

  const loadTab = async (tab, nextPage = page) => {
    if (tab === 'unlisted') {
      const { data } = await api.get('/sku-mappings/unlisted', { params: { channel: unlistedChannel, page: nextPage, limit: PAGE_SIZE } });
      setTotal(data.meta?.total || 0);
      return data.data || [];
    }
    const { data } = await api.get('/sku-mappings', {
      params: { tab, channel: channel || undefined, q: q || undefined, page: nextPage, limit: PAGE_SIZE },
    });
    setTotal(data.meta?.total || 0);
    return data.data || [];
  };

  const load = async (tab = activeTab, nextPage = page) => {
    setLoading(true);
    try {
      const [current, summary, skuRes] = await Promise.all([
        loadTab(tab, nextPage),
        api.get('/sku-mappings/summary', { params: { channel: unlistedChannel } }),
        api.get('/master-skus', { params: { page: masterPage, limit: PAGE_SIZE } }),
      ]);
      setRows(current);
      setCounts(summary.data.data || counts);
      setMasters(skuRes.data.data || []);
      setMasterTotal(skuRes.data.meta?.total || 0);
    } catch (err) {
      toast.error(apiError(err, 'Could not load mappings'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(activeTab, page); }, [page, masterPage]);

  const changeTab = (tab) => {
    setActiveTab(tab);
    setPage(1);
    load(tab, 1);
  };

  const mapExisting = async (id) => {
    const code = mappingInput[id];
    if (!code) return;
    try {
      await api.post(`/sku-mappings/${id}/map`, { masterSkuCode: code });
      toast.success(`Mapped to ${code}`);
      load(activeTab);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const createNew = async (id) => {
    try {
      await api.post(`/sku-mappings/${id}/create-as-new`);
      toast.success('New Master SKU created and mapped');
      load(activeTab);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const unmap = async (id) => {
    try {
      await api.post(`/sku-mappings/${id}/unmap`);
      toast.success('Listing unmapped');
      load(activeTab);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const saveBarcode = async (sku, value) => {
    const barcode = value.trim();
    if (barcode === (sku.barcode || '')) return;
    try {
      await api.patch(`/master-skus/${sku.id}`, { barcode });
      setMasters((rows) => rows.map((row) => (row.id === sku.id ? { ...row, barcode } : row)));
      toast.success(`${sku.code} barcode saved`);
    } catch (err) {
      toast.error(apiError(err, 'Could not save barcode'));
    }
  };

  const retry = async (id) => {
    try {
      const { data } = await api.post(`/sku-mappings/${id}/retry`);
      toast.success(data.message || 'Retry finished');
      load(activeTab);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const tabs = [
    { id: 'mapped', label: 'Mapped', count: counts.mapped },
    { id: 'unmapped', label: 'Unmapped', count: counts.unmapped },
    { id: 'failed', label: 'Failed', count: counts.failed },
    { id: 'unlisted', label: 'Unlisted', count: counts.unlisted },
  ];

  if (loading) return <PageLoader label="Loading SKU mappings..." />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">SKU Mapping</h1>
          <p className="text-muted-foreground">
            Every channel listing attaches to one Master SKU. Match is normalized seller SKU, then barcode — never title.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/import')}>Bulk import</Button>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <GitCompare className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Mapping engine</p>
              <p className="text-sm text-muted-foreground">
                Import Shopify first (creates Master SKUs), then Myntra, then Amazon. No match → Unmapped.
                Type an existing code or Create as new. Failed rows keep the listing; Retry restores a mapped error or re-runs auto-map.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        {tabs.map((tab) => (
          <Button key={tab.id} variant={activeTab === tab.id ? 'default' : 'outline'} size="sm" onClick={() => changeTab(tab.id)}>
            {tab.label} ({tab.count ?? 0})
          </Button>
        ))}
        {activeTab === 'unlisted' ? (
          <div className="w-40">
            <Select
              value={unlistedChannel}
              onChange={(e) => {
                const next = e.target.value;
                setUnlistedChannel(next);
                setActiveTab('unlisted');
                setPage(1);
                setLoading(true);
                Promise.all([
                  api.get('/sku-mappings/unlisted', { params: { channel: next, page: 1, limit: PAGE_SIZE } }),
                  api.get('/sku-mappings/summary', { params: { channel: next } }),
                ]).then(([current, summary]) => {
                  setRows(current.data.data || []);
                  setTotal(current.data.meta?.total || 0);
                  setCounts(summary.data.data || counts);
                }).catch((err) => toast.error(apiError(err, 'Could not load mappings'))).finally(() => setLoading(false));
              }}
            >
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        ) : (
          <div className="w-40">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All channels</option>
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>
        )}
        {activeTab !== 'unlisted' && (
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              className="h-8 w-full rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] pl-7 pr-2 text-sm text-foreground placeholder:text-muted-foreground"
              placeholder="Search SKU / title"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(activeTab, 1); } }}
            />
          </div>
        )}
        <Button size="sm" variant="outline" onClick={() => { setPage(1); load(activeTab, 1); }}>Apply</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {activeTab === 'failed' ? 'Failed sync'
              : activeTab === 'unlisted' ? `Unlisted on ${unlistedChannel}`
                : activeTab === 'unmapped' ? 'Unmapped listings'
                  : 'Mapped listings'}
          </CardTitle>
          <CardDescription>
            {activeTab === 'unlisted'
              ? `Master SKUs with no ${unlistedChannel} mapping. Import that channel’s CSV to list them.`
              : 'Channel rows from Mongo'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing in this tab"
              description={activeTab === 'unlisted' ? 'Every Master SKU is listed on this channel, or none exist yet.' : 'Import a CSV or create a product first.'}
              action={activeTab === 'unlisted' ? <Button variant="outline" onClick={() => navigate('/import')}>Go to import</Button> : null}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel SKU</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  {activeTab === 'failed' && <TableHead>Error</TableHead>}
                  {canCatalogEdit && activeTab !== 'unlisted' && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <ProductThumb name={row.productName || row.channelTitle || row.channelSku} sku={row.channelSku || row.masterSku} src={row.imageUrl} />
                        {row.masterSku ? <Link className="w-4 h-4 text-green-600" /> : <Unlink className="w-4 h-4 text-destructive" />}
                        {row.channelSku}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{row.channel}</Badge></TableCell>
                    <TableCell>
                      <div className="font-medium">{row.masterSku || '—'}</div>
                      <div className="text-xs text-muted-foreground">{row.masterBarcode || row.barcode || 'No barcode'}</div>
                    </TableCell>
                    <TableCell>{row.productName || row.channelTitle}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'error' || row.status === 'Error' ? 'destructive' : 'secondary'}>{row.status}</Badge>
                    </TableCell>
                    {activeTab === 'failed' && (
                      <TableCell className="text-xs text-destructive max-w-xs">{row.error || '—'}</TableCell>
                    )}
                    {canCatalogEdit && activeTab === 'mapped' && (
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => unmap(row.id)}>Unmap</Button>
                      </TableCell>
                    )}
                    {canCatalogEdit && (activeTab === 'unmapped' || activeTab === 'failed') && (
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <input
                            className="h-8 w-36 rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-2 text-sm text-foreground placeholder:text-muted-foreground"
                            list="master-codes"
                            placeholder="Master SKU code"
                            value={mappingInput[row.id] || ''}
                            onChange={(e) => setMappingInput((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          />
                          <Button variant="outline" size="sm" disabled={!mappingInput[row.id]} onClick={() => mapExisting(row.id)}>Map</Button>
                          <Button variant="outline" size="sm" onClick={() => createNew(row.id)}>Create as new</Button>
                          {activeTab === 'failed' && (
                            <Button variant="outline" size="sm" onClick={() => retry(row.id)}>Retry</Button>
                          )}
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

      <datalist id="master-codes">
        {masters.map((sku) => (
          <option key={sku.id} value={sku.code}>{sku.barcode ? `${sku.name} · ${sku.barcode}` : sku.name}</option>
        ))}
      </datalist>

      <Card>
        <CardHeader>
          <CardTitle>Master SKU reference</CardTitle>
          <CardDescription>These codes and barcodes are the Master SKU match. A barcode saved here is used when the next channel imports the same EAN.</CardDescription>
        </CardHeader>
        <CardContent>
          {masters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Master SKUs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Barcode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {masters.map((sku) => (
                  <TableRow key={sku.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <ProductThumb name={sku.name || sku.code} sku={sku.code} src={sku.imageUrl} />
                        {sku.code}
                      </div>
                    </TableCell>
                    <TableCell>{sku.name}</TableCell>
                    <TableCell>
                      <input
                        key={`${sku.id}-${sku.barcode || ''}`}
                        defaultValue={sku.barcode || ''}
                        placeholder="Barcode / EAN"
                        className="h-8 w-40 rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-2 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                        onBlur={(e) => saveBarcode(sku, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={masterPage} total={masterTotal} limit={PAGE_SIZE} onPage={setMasterPage} />
        </CardContent>
      </Card>
    </div>
  );
}
