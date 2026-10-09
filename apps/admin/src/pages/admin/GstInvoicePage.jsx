import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate } from '../../utils/format';
import { isChannelManaged, packetIdOf, openMyntraDocument } from '../../lib/channelOrders';
import { lineTax, downloadCsv, isCancelled } from '../../lib/orderMetrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { FileText, Download, AlertTriangle, Receipt } from 'lucide-react';

const TABS = [
  { id: 'invoiced', label: 'Tax invoices' },
  { id: 'pending', label: 'Shipped, no invoice' },
  { id: 'notes', label: 'Credit notes needed' },
];

function invoiceNoOf(order) {
  return order.invoiceNo || (order.channelLines || []).find((line) => line.invoiceNumber)?.invoiceNumber || '';
}

function orderTax(order) {
  return (order.items || []).reduce((acc, item) => {
    const tax = lineTax(item);
    acc.taxable += tax.taxable;
    acc.gst += tax.cgst + tax.sgst + tax.igst;
    acc.gross += tax.gross;
    return acc;
  }, { taxable: 0, gst: 0, gross: 0 });
}

export default function GstInvoicePage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const generateInvoice = useOrderStore((s) => s.generateInvoice);
  const [company, setCompany] = useState(null);
  const [tab, setTab] = useState('invoiced');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
    api.get('/settings/company').then(({ data }) => setCompany(data.data)).catch(() => setCompany(null));
  }, [hydrateFromApi]);

  const rows = useMemo(() => orders.map((order) => ({
    order,
    invoiceNo: invoiceNoOf(order),
    tax: orderTax(order),
  })).sort((a, b) => String(b.order.createdAt).localeCompare(String(a.order.createdAt))), [orders]);

  const groups = useMemo(() => ({
    invoiced: rows.filter((row) => row.invoiceNo && !isCancelled(row.order)),
    pending: rows.filter((row) => !row.invoiceNo && ['Dispatched', 'Delivered'].includes(row.order.status)),
    notes: rows.filter((row) => row.invoiceNo && isCancelled(row.order)),
  }), [rows]);

  const hsnSummary = useMemo(() => {
    const map = new Map();
    groups.invoiced.forEach(({ order }) => (order.items || []).forEach((item) => {
      const key = `${item.hsn || '—'}|${item.gst ?? '—'}`;
      const tax = lineTax(item);
      const row = map.get(key) || { hsn: item.hsn || '—', rate: item.gst, qty: 0, taxable: 0, gst: 0 };
      row.qty += Number(item.qty) || 1;
      row.taxable += tax.taxable;
      row.gst += tax.cgst + tax.sgst + tax.igst;
      map.set(key, row);
    }));
    return [...map.values()].sort((a, b) => b.taxable - a.taxable);
  }, [groups.invoiced]);

  const totals = groups.invoiced.reduce((acc, row) => ({
    taxable: acc.taxable + row.tax.taxable,
    gst: acc.gst + row.tax.gst,
  }), { taxable: 0, gst: 0 });

  const openInvoice = async (order) => {
    setBusy(order.id);
    try {
      if (isChannelManaged(order)) {
        await openMyntraDocument(order, 'invoice');
      } else {
        const next = await generateInvoice(order.id);
        if (next?.error) toast.error(next.error);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const exportRegister = () => {
    const list = groups[tab];
    if (!list.length) {
      toast.error('Nothing to export in this tab');
      return;
    }
    const lines = list.flatMap(({ order, invoiceNo }) => (order.items || []).map((item) => {
      const tax = lineTax(item);
      return [invoiceNo, order.createdAt ? String(order.createdAt).slice(0, 10) : '', order.id, order.channel, order.customer,
        item.sku, item.name, item.hsn || '', item.gst ?? '', item.qty, tax.taxable.toFixed(2), (tax.cgst + tax.sgst + tax.igst).toFixed(2), tax.gross.toFixed(2)];
    }));
    downloadCsv(`gst-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Invoice No', 'Date', 'Order', 'Channel', 'Customer', 'SKU', 'Item', 'HSN', 'GST %', 'Qty', 'Taxable', 'GST', 'Total'], lines);
    toast.success(`${lines.length} invoice lines exported`);
  };

  if (!loaded) return <PageLoader label="Loading invoices..." />;

  const list = groups[tab];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">GST Invoice</h1>
          <p className="text-muted-foreground">
            Myntra and Amazon issue the tax invoice for their orders; open it from here. Shopify and manual orders are invoiced by OMSKing (invoice no. = Order ID for Shopify).
          </p>
        </div>
        <Button variant="outline" onClick={exportRegister}>
          <Download className="w-4 h-4 mr-2" />
          Export register (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Tax invoices" value={groups.invoiced.length} icon={Receipt} onClick={() => setTab('invoiced')} />
        <KpiCard label="Taxable value" value={formatINR(Math.round(totals.taxable))} icon={FileText} />
        <KpiCard label="GST" value={formatINR(Math.round(totals.gst))} icon={FileText} />
        <KpiCard label="Credit notes needed" value={groups.notes.length} icon={AlertTriangle} onClick={() => setTab('notes')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supplier</CardTitle>
          <CardDescription>From Settings → Company. Tax is split from the GST-inclusive selling price using each item's GST %.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {company ? (
            <div className="grid gap-1 sm:grid-cols-3">
              <div><span className="text-muted-foreground">Name:</span> {company.companyName || '—'}</div>
              <div><span className="text-muted-foreground">GSTIN:</span> {company.gstin || <span className="text-destructive">not set</span>}</div>
              <div><span className="text-muted-foreground">City:</span> {company.city || '—'}</div>
            </div>
          ) : (
            <p className="text-muted-foreground">Company details need Settings access. <button type="button" className="text-primary hover:underline" onClick={() => navigate('/settings')}>Open Settings</button></p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((item) => (
          <Button key={item.id} size="sm" variant={tab === item.id ? 'default' : 'outline'} onClick={() => setTab(item.id)}>
            {item.label} ({groups[item.id].length})
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{TABS.find((item) => item.id === tab).label}</CardTitle>
          {tab === 'notes' && <CardDescription>These orders were cancelled after the invoice was issued. Issue a credit note — never delete the original invoice. Marketplace orders get the note from the marketplace.</CardDescription>}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <EmptyState title="Nothing here" description={tab === 'pending' ? 'Every shipped order has an invoice.' : 'No invoices in this view yet.'} />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[960px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map(({ order, invoiceNo, tax }) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium font-mono text-xs">{invoiceNo || '—'}</TableCell>
                      <TableCell>{order.createdAt ? formatDate(order.createdAt) : '—'}</TableCell>
                      <TableCell>
                        <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>{order.id}</button>
                      </TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell>{order.customer}</TableCell>
                      <TableCell className="text-right">{formatINR(Math.round(tax.taxable))}</TableCell>
                      <TableCell className="text-right">{formatINR(Math.round(tax.gst))}</TableCell>
                      <TableCell className="text-right font-medium">{formatINR(order.total)}</TableCell>
                      <TableCell>
                        {(isChannelManaged(order) ? packetIdOf(order) : true) && (
                          <Button variant="ghost" size="sm" disabled={busy === order.id} onClick={() => openInvoice(order)}>
                            {isChannelManaged(order) ? `${order.channel} invoice` : invoiceNo ? 'Print' : 'Generate'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {tab === 'invoiced' && hsnSummary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>HSN summary</CardTitle>
            <CardDescription>For GSTR-1 table 12. Lines without HSN need it set on Products.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HSN</TableHead>
                  <TableHead>GST %</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hsnSummary.map((row) => (
                  <TableRow key={`${row.hsn}-${row.rate}`}>
                    <TableCell className="font-mono">{row.hsn}</TableCell>
                    <TableCell>{row.rate != null ? `${row.rate}%` : '—'}</TableCell>
                    <TableCell className="text-right">{row.qty}</TableCell>
                    <TableCell className="text-right">{formatINR(Math.round(row.taxable))}</TableCell>
                    <TableCell className="text-right">{formatINR(Math.round(row.gst))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
