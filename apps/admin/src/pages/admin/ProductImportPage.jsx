import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { ArrowRight, Download, RefreshCw, Upload } from 'lucide-react';
import ProductThumb from '../../components/ui/ProductThumb';
import api, { apiError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const STEPS = [
  { id: 'shopify', name: 'Shopify' },
  { id: 'myntra', name: 'Myntra' },
  { id: 'amazon', name: 'Amazon' },
];

const SAMPLE_CSV = `channelSkuCode,channelVariantId,channelProductId,title,barcode,price,hsnCode,color,size
SKU-001,VAR-001,PROD-001,Product title,8900000000001,1999,6204,Blue,M
SKU-002,VAR-002,PROD-001,Product title,8900000000002,1999,6204,Blue,L`;

function downloadTemplate() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'omsking-channel-import.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ProductImportPage() {
  const navigate = useNavigate();
  const { canCatalogEdit } = usePermissions();
  const [masterChannel, setMasterChannel] = useState('');
  const [done, setDone] = useState({});
  const [summary, setSummary] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRefs = useRef({});

  useEffect(() => {
    api.get('/sku-mappings/import-order')
      .then(({ data }) => setMasterChannel(data.data?.masterChannel || 'myntra'))
      .catch(() => setMasterChannel('myntra'));
  }, []);

  const hintFor = (id) => {
    if (id === 'shopify') {
      return 'First. Each new row creates a Master SKU. The same channelProductId stays one product.';
    }
    if (id === 'myntra') {
      return masterChannel === 'shopify'
        ? 'Same seller SKU or barcode auto-maps onto the Shopify master. No match stays Unmapped.'
        : 'Shopify is not the catalog yet, so a new Myntra row creates a Master SKU. A matching SKU or barcode stays one master.';
    }
    return 'Last. A matching SKU or barcode auto-maps. No match stays Unmapped and does not create stock.';
  };

  const applyResult = (channel, data) => {
    setDone((prev) => ({ ...prev, [channel]: true }));
    setSummary(data);
    setResults(data?.rows || []);
  };

  const pullLive = async (channel) => {
    setBusy(`pull-${channel}`);
    try {
      const { data } = await api.post('/sku-mappings/pull', { channel });
      applyResult(channel, data.data);
      const row = data.data || {};
      toast.success(`${channel}: ${row.created || 0} created, ${row.autoMapped || 0} auto-mapped, ${row.unmapped || 0} unmapped`);
    } catch (err) {
      toast.error(apiError(err, 'Catalog pull failed'));
    } finally {
      setBusy('');
    }
  };

  const runFile = async (channel, file) => {
    const csv = await file.text();
    setBusy(channel);
    try {
      const { data } = await api.post('/sku-mappings/import', { channel, csv });
      applyResult(channel, data.data);
      toast.success(`${channel}: ${data.data?.created || 0} created, ${data.data?.autoMapped || 0} auto-mapped, ${data.data?.unmapped || 0} unmapped`);
    } catch (err) {
      toast.error(apiError(err, 'Import failed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Bulk product import</h1>
          <p className="text-muted-foreground">
            Shopify first, then Myntra, then Amazon. Pull live catalog or upload CSV. The same seller SKU or barcode stays one Master SKU. Amazon never creates a new master. No import creates stock.
            {masterChannel === 'myntra' ? ' Shopify is not connected, so Myntra rows can create the master.' : ' Shopify owns the catalog, so Myntra and Amazon only auto-map.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Download template
          </Button>
          <Button variant="outline" onClick={() => navigate('/sku-mapping')}>Open mapping</Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Columns: channelSkuCode, channelVariantId, channelProductId, title, barcode, price, hsnCode, color, size.
        Quoted commas are supported. Re-importing the same channelVariantId updates title/price and reports <strong>exists</strong>.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <Card key={step.id}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {index + 1}. {step.name}
                {done[step.id] && <Badge variant="outline">Imported</Badge>}
              </CardTitle>
              <CardDescription>{hintFor(step.id)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <input
                ref={(el) => { fileRefs.current[step.id] = el; }}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={!canCatalogEdit || Boolean(busy)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) runFile(step.id, file);
                  e.target.value = '';
                }}
              />
              <Button
                className="w-full"
                variant="outline"
                disabled={!canCatalogEdit || Boolean(busy)}
                onClick={() => pullLive(step.id)}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {busy === `pull-${step.id}` ? 'Pulling…' : 'Pull live catalog'}
              </Button>
              <Button
                className="w-full"
                variant={done[step.id] ? 'outline' : 'default'}
                disabled={!canCatalogEdit || Boolean(busy)}
                onClick={() => fileRefs.current[step.id]?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {busy === step.id ? 'Importing…' : 'Upload CSV'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Shopify <ArrowRight className="w-4 h-4" /> Myntra <ArrowRight className="w-4 h-4" /> Amazon
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {[
            ['Created', summary.created],
            ['Auto-mapped', summary.autoMapped],
            ['Unmapped', summary.unmapped],
            ['Exists', summary.exists],
            ['Failed', summary.failed],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardContent className="pt-4">
                <p className="text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold">{value || 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Last import result</CardTitle>
          <CardDescription>created / auto-mapped / unmapped / exists / failed</CardDescription>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">Upload a CSV to import. Nothing is written until you do.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsSafe(results).map((row, i) => (
                  <TableRow key={`${row.channel}-${row.sku}-${i}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <ProductThumb name={row.title || row.sku} sku={row.sku} src={row.image} />
                        {row.sku}
                      </div>
                    </TableCell>
                    <TableCell>{row.title}</TableCell>
                    <TableCell>{row.channel}</TableCell>
                    <TableCell className="font-mono text-xs">{row.masterSku || '—'}</TableCell>
                    <TableCell>{row.result}{row.error ? ` — ${row.error}` : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function rowsSafe(results) {
  return Array.isArray(results) ? results : [];
}
