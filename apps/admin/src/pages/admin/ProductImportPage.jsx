import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { ArrowRight, Download, Upload } from 'lucide-react';
import api, { apiError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const STEPS = [
  { id: 'shopify', name: 'Shopify', hint: 'Import first. Each new row creates a Master SKU (same channelProductId stays one product).' },
  { id: 'myntra', name: 'Myntra', hint: 'Second. Same seller SKU or barcode auto-maps. No match → Unmapped.' },
  { id: 'amazon', name: 'Amazon', hint: 'Last. Unmatched rows stay Unmapped until you Map or Create as new.' },
];

const SAMPLE_CSV = `channelSkuCode,channelVariantId,channelProductId,title,barcode,price,hsnCode,color,size
LHK-BL-001,VAR-BL-001,PROD-KURTA,Leheriya Kurta,8901000000001,1899,6204,Blue,M
LHK-BL-002,VAR-BL-002,PROD-KURTA,Leheriya Kurta,8901000000008,1899,6204,Blue,L
NEW-DUP-009,VAR-DUP-009,PROD-DUP,Festival Dupatta,,799,6214,Red,`;

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
  const [done, setDone] = useState({});
  const [summary, setSummary] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRefs = useRef({});

  const applyResult = (channel, data) => {
    setDone((prev) => ({ ...prev, [channel]: true }));
    setSummary(data);
    setResults(data?.rows || []);
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

  const runSample = async (channel) => {
    setBusy(channel);
    try {
      const { data } = await api.post('/sku-mappings/import', { channel, csv: SAMPLE_CSV });
      applyResult(channel, data.data);
      toast.success(`${channel} sample imported`);
    } catch (err) {
      toast.error(apiError(err, 'Import failed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Bulk product import</h1>
          <p className="text-muted-foreground">
            Order is locked: Shopify → Myntra → Amazon. Live marketplace pull is later — CSV is the catalog source for now.
          </p>
        </div>
        <div className="flex gap-2">
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
              <CardDescription>{step.hint}</CardDescription>
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
                variant={done[step.id] ? 'outline' : 'default'}
                disabled={!canCatalogEdit || Boolean(busy)}
                onClick={() => fileRefs.current[step.id]?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {busy === step.id ? 'Importing…' : 'Upload CSV'}
              </Button>
              {canCatalogEdit && (
                <Button className="w-full" variant="ghost" disabled={Boolean(busy)} onClick={() => runSample(step.id)}>
                  Run sample rows
                </Button>
              )}
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
            <p className="text-sm text-muted-foreground">Upload a CSV or run sample rows.</p>
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
                    <TableCell className="font-medium">{row.sku}</TableCell>
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
