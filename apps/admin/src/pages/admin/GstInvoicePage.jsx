import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../../lib/api';
import useOrderStore from '../../stores/orderStore';
import { formatINR, formatDate } from '../../utils/format';
import { isChannelManaged, packetIdOf, openMyntraDocument } from '../../lib/channelOrders';
import { channelIssuesInvoice } from '../../lib/channelInvoice';
import { downloadPdfBase64 } from '../../lib/orderPrint';
import { downloadCsv, istDate } from '../../lib/orderMetrics';
import { lineTax, registerGroups, registerTotals } from '../../lib/gstRegister';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { FileText, Download, AlertTriangle, Receipt } from 'lucide-react';
import Pagination, { useClientPage } from '../../components/ui/Pagination';

const TABS = [
  { id: 'invoiced', label: 'Tax invoices' },
  { id: 'pending', label: 'Shipped, no invoice' },
  { id: 'notes', label: 'Credit notes needed' },
];

const money = (value) => Number(value || 0).toFixed(2);
const inr2 = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export default function GstInvoicePage() {
  const navigate = useNavigate();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const generateInvoice = useOrderStore((s) => s.generateInvoice);
  const [company, setCompany] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [tab, setTab] = useState('invoiced');
  const [busy, setBusy] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    hydrateFromApi();
    api.get('/settings/company').then(({ data }) => setCompany(data.data)).catch(() => setCompany(null));
    api.get('/warehouses').then(({ data }) => {
      setWarehouses(Array.isArray(data.data) ? data.data : (data.data?.warehouses || []));
    }).catch(() => setWarehouses([]));
  }, [hydrateFromApi]);

  const gstin = company?.gstin || '';
  const warehouseState = warehouses.find((row) => row.code === 'WH-001')?.address?.state || '';
  const groups = useMemo(() => registerGroups(orders, { warehouses, gstin, from, to }), [orders, warehouses, gstin, from, to]);

  const hsnSummary = useMemo(() => {
    const map = new Map();
    groups.invoiced.forEach(({ order, tax: orderTaxRow }) => (order.items || []).forEach((item) => {
      const key = `${item.hsn || '—'}|${item.gst ?? '—'}`;
      const tax = lineTax(item, orderTaxRow);
      if (tax.rateMissing) return;
      const row = map.get(key) || { hsn: item.hsn || '—', rate: item.gst, qty: 0, taxable: 0, gst: 0 };
      row.qty += Number(item.qty) || 1;
      row.taxable += tax.taxable;
      row.cgst = (row.cgst || 0) + tax.cgst;
      row.sgst = (row.sgst || 0) + tax.sgst;
      row.igst = (row.igst || 0) + tax.igst;
      row.gst += tax.cgst + tax.sgst + tax.igst;
      map.set(key, row);
    }));
    return [...map.values()].sort((a, b) => b.taxable - a.taxable);
  }, [groups.invoiced]);

  const totals = registerTotals(groups.invoiced);

  const invoiceNote = (email) => {
    if (email?.emailed) return 'PDF opened and emailed from the company mailbox.';
    if (email?.mailError) return 'Email did not send. The PDF is still ready.';
    if (email?.reason === 'gmail') return 'PDF ready. Email skipped because company Gmail is not saved.';
    return 'PDF ready.';
  };

  const openInvoice = async (order, { download = false } = {}) => {
    setBusy(order.id);
    try {
      if (isChannelManaged(order)) {
        await openMyntraDocument(order, 'invoice');
        return;
      }
      const kind = tab === 'notes' ? 'credit' : 'invoice';
      const next = await generateInvoice(order.id, { kind, email: !download, preview: !download });
      if (next?.error) {
        toast.error(next.error);
        return;
      }
      const filename = `${kind === 'credit' ? next.creditNote || `CN-${next.invoiceNo || order.id}` : (next.invoiceNo || order.id)}.pdf`;
      if (download && next.invoicePdf) downloadPdfBase64(next.invoicePdf, filename);
      toast.success(download ? 'PDF downloaded.' : invoiceNote(next.invoiceEmail));
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
    const lines = list.flatMap(({ order, invoiceNo, date, tax: orderTaxRow }) => (order.items || []).map((item) => {
      const tax = lineTax(item, orderTaxRow);
      return [invoiceNo, date, order.id, order.channel,
        item.sku, item.name, item.hsn || '', tax.rateMissing ? 'Rate missing' : tax.rate, item.qty,
        money(tax.taxable), money(tax.cgst), money(tax.sgst), money(tax.igst), money(tax.gross)];
    }));
    downloadCsv(`gst-${tab}-${istDate(new Date())}.csv`,
      ['Invoice No', 'Date', 'Order', 'Channel', 'SKU', 'Item', 'HSN', 'GST %', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'], lines);
    toast.success(`${lines.length} invoice lines exported`);
  };

  const list = groups[tab] || [];
  const paged = useClientPage(list);

  if (!loaded) return <PageLoader label="Loading invoices..." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">GST Invoice</h1>
          <p className="text-muted-foreground">
            Myntra and Amazon issue the tax invoice for their orders; open it from here. Shopify and manual orders are invoiced by OMSKing (invoice no. = Order ID for Shopify).
          </p>
        </div>
        <Button variant="outline" onClick={() => {
          const ready = (row) => !row.tax.rateMissing;
          const skipped = groups.invoiced.filter((row) => !ready(row)).length + groups.notes.filter((row) => !ready(row)).length;
          const lines = groups.invoiced.filter(ready).flatMap(({ order, invoiceNo, date, tax }) => (order.items || []).map((item) => {
            const row = lineTax(item, tax);
            return ['Sales', invoiceNo, date, order.id, money(row.taxable), money(row.cgst), money(row.sgst), money(row.igst), money(row.gross)];
          })).concat(groups.notes.filter(ready).map(({ order, creditNote, date, tax }) => (
            ['Credit Note', creditNote, date, order.id, money(-tax.taxable), money(-tax.cgst), money(-tax.sgst), money(-tax.igst), money(-tax.gross)]
          )));
          if (!lines.length) {
            toast.error('Nothing to export for Tally');
            return;
          }
          downloadCsv(`tally-gst-${from || 'start'}-to-${to || istDate(new Date()).slice(0, 7)}.csv`,
            ['Voucher', 'Number', 'Date', 'Order', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'], lines);
          toast.success(skipped
            ? `Tally CSV downloaded. ${skipped} invoice(s) left out: Rate missing. Set the GST % and export again.`
            : 'Tally CSV downloaded. This is a file export, not a Tally API.');
        }}>
          <Download className="w-4 h-4 mr-2" />
          Tally export
        </Button>
        <Button variant="outline" onClick={exportRegister}>
          <Download className="w-4 h-4 mr-2" />
          Export register (CSV)
        </Button>
      </div>

      <div className="flex items-end gap-3 flex-wrap text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">From month</span>
          <input type="month" className="border rounded-md px-2 py-1 bg-background" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">To month</span>
          <input type="month" className="border rounded-md px-2 py-1 bg-background" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>All months</Button>}
        <span className="text-muted-foreground">Dates are the invoice date in India time; the exports follow this filter.</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard label="Tax invoices" value={groups.invoiced.length} icon={Receipt} onClick={() => setTab('invoiced')} />
        <KpiCard label="Taxable value" value={formatINR(Math.round(totals.taxable))} icon={FileText} />
        <KpiCard label="GST" value={formatINR(Math.round(totals.gst))} icon={FileText} />
        <KpiCard label="Rate missing" value={totals.rateMissing} icon={AlertTriangle} />
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
              <div><span className="text-muted-foreground">WH-001 state:</span> {warehouseState || <span className="text-destructive">not set</span>}</div>
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
          {tab === 'notes' && <CardDescription>OMS invoices that were issued and then cancelled, returned or sent back (RTO). Issue a credit note — never delete the original invoice. Marketplace orders get the note from the marketplace, so they are not listed.</CardDescription>}
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <EmptyState title="Nothing here" description={tab === 'pending' ? 'Every shipped order has an invoice.' : 'No invoices in this view yet.'} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                    {tab === 'notes' && <TableHead>Credit note</TableHead>}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.rows.map(({ order, invoiceNo, date, tax, creditNote }) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium font-mono text-xs">{invoiceNo || '—'}</TableCell>
                      <TableCell>{date ? formatDate(date) : '—'}</TableCell>
                      <TableCell>
                        <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/orders/${encodeURIComponent(order.id)}`)}>{order.id}</button>
                      </TableCell>
                      <TableCell><Badge variant="outline">{order.channel}</Badge></TableCell>
                      <TableCell>{order.customer}</TableCell>
                      {tax.rateMissing ? (
                        <TableCell colSpan={4} className="text-right text-destructive">Rate missing: set the GST % on the SKU</TableCell>
                      ) : (
                        <>
                          <TableCell className="text-right">{inr2(tax.taxable)}</TableCell>
                          <TableCell className="text-right">{inr2(tax.cgst)}</TableCell>
                          <TableCell className="text-right">{inr2(tax.sgst)}</TableCell>
                          <TableCell className="text-right">{inr2(tax.igst)}</TableCell>
                        </>
                      )}
                      {tab === 'notes' && <TableCell className="font-mono text-xs">{creditNote}</TableCell>}
                      <TableCell className="text-right font-medium">{inr2(tax.gross)}</TableCell>
                      <TableCell>
                        {(isChannelManaged(order) ? packetIdOf(order) : !channelIssuesInvoice(order)) && (
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="sm" disabled={busy === order.id} onClick={() => openInvoice(order)}>
                              {isChannelManaged(order) ? `${order.channel} invoice` : tab === 'notes' ? 'Credit note PDF' : 'PDF'}
                            </Button>
                            {!isChannelManaged(order) && (
                              <Button variant="ghost" size="sm" disabled={busy === order.id} onClick={() => openInvoice(order, { download: true })}>
                                Download
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={paged.page} total={paged.total} limit={paged.limit} onPage={paged.setPage} />
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
