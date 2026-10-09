import { useEffect, useMemo, useState } from 'react';
import api, { apiError } from '../../lib/api';
import { formatDateTime } from '../../utils/format';
import { downloadCsv } from '../../lib/orderMetrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import ProductThumb from '../../components/ui/ProductThumb';
import { Search, Download } from 'lucide-react';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';

function showValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function changeText(changes) {
  return (changes || []).map((change) => `${change.field}: ${showValue(change.before)} → ${showValue(change.after)}`).join('; ');
}

export default function AuditLogsPage() {
  const [rows, setRows] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    Promise.all([
      api.get('/audit-logs', { params: { page, limit: PAGE_SIZE, q: applied || undefined } }),
      api.get('/inventory/ledger', { params: { page: ledgerPage, limit: PAGE_SIZE } }),
    ]).then(([auditRes, ledgerRes]) => {
      setRows(auditRes.data.data || []);
      setTotal(auditRes.data.meta?.total || 0);
      setLedger(ledgerRes.data.data || []);
      setLedgerTotal(ledgerRes.data.meta?.total || 0);
    }).catch((err) => {
      setError(apiError(err, 'Could not load the audit log'));
      setRows([]);
    });
  }, [page, ledgerPage, applied]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((row) => [row.actorName, row.actorRole, row.action, row.resourceDisplay, changeText(row.changes)]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [rows, query]);

  const filteredLedger = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((row) => [row.sku, row.productName, row.type, row.reason, row.referenceId, row.performedBy, row.warehouse]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [ledger, query]);

  const exportRows = () => downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`,
    ['When', 'Who', 'Role', 'Action', 'Record', 'Changes'],
    filtered.map((row) => [row.at, row.actorName || 'System', row.actorRole, row.action, row.resourceDisplay, changeText(row.changes)]));

  if (rows === null) return <PageLoader label="Loading audit log..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Audit Logs</h1>
          <p className="text-muted-foreground">Who changed company, tax, users, roles, channels, catalog and order status, with the value before and after. The log is append-only.</p>
        </div>
        <Button variant="outline" onClick={exportRows} disabled={!filtered.length}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by person, action, order or field..."
              className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Record changes ({total})</CardTitle>
          <CardDescription>One page at a time. Secrets are not stored.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No record changes yet" description="Saving company, tax, a user, a role, a channel or an order status writes a before/after row here." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead>Before → after</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(row.at)}</TableCell>
                      <TableCell>
                        <div>{row.actorName || 'System'}</div>
                        <div className="text-xs text-muted-foreground">{row.actorRole}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{String(row.action || '').replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell>
                        <div>{row.resourceDisplay || '—'}</div>
                        <div className="text-xs text-muted-foreground">{row.resourceType}</div>
                      </TableCell>
                      <TableCell className="max-w-md text-xs">{changeText(row.changes) || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock ledger ({ledgerTotal})</CardTitle>
          <CardDescription>Every stock movement with the balance after. This ledger stays separate from the record log.</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredLedger.length === 0 ? (
            <EmptyState title="No stock movements yet" description="Stock-in, adjustments, reservations and restocks show here." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLedger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">{formatDateTime(row.at)}</TableCell>
                      <TableCell>{row.performedBy || 'System'}</TableCell>
                      <TableCell><Badge variant="outline">{String(row.type || '').replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ProductThumb name={row.productName || row.sku} src={row.imageUrl} />
                          <div>
                            <div className="font-mono text-xs">{row.sku}</div>
                            <div className="text-xs text-muted-foreground">{row.productName}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{row.warehouse}</TableCell>
                      <TableCell className={`text-right font-medium ${row.qty < 0 ? 'text-destructive' : 'text-green-600'}`}>{row.qty > 0 ? `+${row.qty}` : row.qty}</TableCell>
                      <TableCell className="text-right">{row.after} <span className="text-xs text-muted-foreground">({row.availableAfter} avail.)</span></TableCell>
                      <TableCell className="text-xs">
                        <div>{row.referenceId || '—'}</div>
                        <div className="text-muted-foreground">{row.reason}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination page={ledgerPage} total={ledgerTotal} limit={PAGE_SIZE} onPage={setLedgerPage} />
        </CardContent>
      </Card>
    </div>
  );
}
