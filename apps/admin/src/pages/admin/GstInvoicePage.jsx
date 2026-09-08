import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { invoices, orders } from '../../mocks';
import { formatINR, formatDate } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { FileText, Download, Printer, Send, Upload, Edit, QrCode } from 'lucide-react';

const MASTER_HSN = {
  6202: 12,
  6203: 12,
  6204: 12,
  6209: 12,
  6214: 5,
};

const orderChannel = Object.fromEntries(orders.map((o) => [o.id, o.channel]));

function invoiceNumber(invoice) {
  return orderChannel[invoice.orderId] === 'Shopify' ? invoice.orderId : invoice.invoiceNo;
}

export default function GstInvoicePage() {
  const [selectedInvoice, setSelectedInvoice] = useState(invoices[0]);
  const [editMode, setEditMode] = useState(false);
  const [lineEdits, setLineEdits] = useState({});
  const [docTab, setDocTab] = useState('invoices');

  const handleEditHSN = () => {
    setEditMode(!editMode);
  };

  const handleUploadMasterHSN = () => {
    console.log('Uploading master HSN file');
    toast.success('Master HSN list uploaded. GST % is taken from HSN.');
  };

  const displayNo = invoiceNumber(selectedInvoice);

  const handleDownloadPDF = () => {
    console.log('Downloading PDF for invoice:', displayNo);
    toast.success(`Downloading ${displayNo}`);
  };

  const handlePrint = () => {
    console.log('Printing invoice:', displayNo);
    toast.success(`Print queued for ${displayNo}`);
  };

  const handleSendWhatsApp = () => {
    console.log('Sending invoice via WhatsApp:', displayNo);
    toast.success(`Invoice ${displayNo} sent on WhatsApp`);
  };

  const handleSendEmail = () => {
    console.log('Sending invoice via email:', displayNo);
    toast.success(`Invoice ${displayNo} emailed to customer`);
  };

  const generateAll = () => {
    console.log('[GST] Generate invoices for all orders', orders.map((o) => o.id));
    toast.success(`Invoice generated for ${orders.length} orders`);
  };

  const hsnValue = (item, index) => lineEdits[index]?.hsn ?? item.hsn;
  const gstValue = (item, index) => {
    const hsn = hsnValue(item, index);
    if (MASTER_HSN[hsn] != null) return MASTER_HSN[hsn];
    return lineEdits[index]?.gstPercent ?? item.gstPercent;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">GST Invoice</h1>
          <p className="text-muted-foreground">
            Invoices can be generated for every order. For Shopify, invoice number is the Order ID.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleUploadMasterHSN}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Master HSN
          </Button>
          <Button variant="outline" onClick={handleEditHSN}>
            <Edit className="w-4 h-4 mr-2" />
            {editMode ? 'View Mode' : 'Edit Details'}
          </Button>
          <Button onClick={generateAll}>
            <FileText className="w-4 h-4 mr-2" />
            Generate for All Orders
          </Button>
          <Button variant="outline" onClick={() => toast.success('GST JSON exported for Tally / Busy')}>
            Export Tally / Busy
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={docTab === 'invoices' ? 'default' : 'outline'} onClick={() => setDocTab('invoices')}>Tax invoices</Button>
        <Button size="sm" variant={docTab === 'notes' ? 'default' : 'outline'} onClick={() => setDocTab('notes')}>Credit / debit notes</Button>
      </div>


      {docTab === 'notes' && (
        <Card>
          <CardHeader>
            <CardTitle>Credit / debit notes</CardTitle>
            <CardDescription>Cancel or return must issue a note — never delete the original invoice.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Note</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Against invoice</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">CN-65215</TableCell>
                  <TableCell>Credit</TableCell>
                  <TableCell>INV-65215-LEH</TableCell>
                  <TableCell>65215-LEH</TableCell>
                  <TableCell>{formatINR(10079)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">DN-65208</TableCell>
                  <TableCell>Debit</TableCell>
                  <TableCell>INV-65208-LEH</TableCell>
                  <TableCell>65208-LEH</TableCell>
                  <TableCell>{formatINR(120)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {docTab === 'invoices' && (
        <>
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.slice(0, 10).map((invoice) => (
                <TableRow 
                  key={invoice.invoiceNo}
                  className={selectedInvoice.invoiceNo === invoice.invoiceNo ? 'bg-primary/5' : ''}
                  onClick={() => setSelectedInvoice(invoice)}
                >
                  <TableCell className="font-medium">{invoiceNumber(invoice)}</TableCell>
                  <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                  <TableCell>{invoice.orderId}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{orderChannel[invoice.orderId] || '—'}</Badge>
                  </TableCell>
                  <TableCell>{invoice.customerName}</TableCell>
                  <TableCell>{formatINR(invoice.grandTotal)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">View</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invoice Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Preview - {displayNo}</CardTitle>
          <CardDescription>
            {orderChannel[selectedInvoice.orderId] === 'Shopify'
              ? 'Shopify rule: Invoice Number = Order ID.'
              : 'GST invoice with HSN-based tax. GST % is taken from the Master HSN list.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-6 bg-white dark:bg-gray-900">
            {/* Invoice Header */}
            <div className="grid grid-cols-3 gap-6 mb-6 pb-6 border-b">
              <div>
                <h3 className="font-bold text-lg mb-2">Supplier</h3>
                <p className="font-medium">Leheriya Creations</p>
                <p className="text-sm text-muted-foreground">GSTIN: 27AAPFU0939G1ZV</p>
                <p className="text-sm text-muted-foreground">PAN: AAPFU0939G</p>
                <p className="text-sm text-muted-foreground">Jaipur, Rajasthan</p>
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-primary mb-2">TAX INVOICE</h2>
                <p className="text-sm text-muted-foreground">{displayNo}</p>
                <p className="text-sm text-muted-foreground">Date: {formatDate(selectedInvoice.invoiceDate)}</p>
              </div>
              <div className="text-right">
                <h3 className="font-bold text-lg mb-2">Bill To / Ship To</h3>
                <p className="font-medium">{selectedInvoice.customerName}</p>
                <p className="text-sm text-muted-foreground">{selectedInvoice.customerAddress}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedInvoice.customerAddress?.includes('Mumbai') ? 'B2B · GSTIN 27AAPFU0000Z1Z' : 'B2C · no GSTIN'}
                </p>
                <p className="text-sm text-muted-foreground">State: Rajasthan</p>
                <p className="text-sm text-muted-foreground">Code: 27</p>
              </div>
            </div>

            {/* Invoice Items Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>GST %</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Taxable Value</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedInvoice.items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <div className="font-medium">{item.product}</div>
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                    </TableCell>
                    <TableCell>
                      {editMode ? (
                        <input
                          type="text"
                          value={hsnValue(item, index)}
                          onChange={(e) =>
                            setLineEdits((prev) => ({
                              ...prev,
                              [index]: { ...prev[index], hsn: e.target.value },
                            }))
                          }
                          className="w-20 px-2 py-1 border rounded text-sm"
                        />
                      ) : (
                        item.hsn
                      )}
                    </TableCell>
                    <TableCell>
                      {editMode ? (
                        <input
                          type="number"
                          value={gstValue(item, index)}
                          onChange={(e) =>
                            setLineEdits((prev) => ({
                              ...prev,
                              [index]: { ...prev[index], gstPercent: Number(e.target.value) },
                            }))
                          }
                          className="w-16 px-2 py-1 border rounded text-sm"
                        />
                      ) : (
                        `${gstValue(item, index)}%`
                      )}
                    </TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatINR(item.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatINR(item.taxableValue)}</TableCell>
                    <TableCell className="text-right">{formatINR(item.cgst)}</TableCell>
                    <TableCell className="text-right">{formatINR(item.sgst)}</TableCell>
                    <TableCell className="text-right">{formatINR(item.igst)}</TableCell>
                    <TableCell className="text-right">{formatINR(item.discount)}</TableCell>
                    <TableCell className="text-right font-medium">{formatINR(item.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Invoice Totals */}
            <div className="mt-6 flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Taxable Value:</span>
                  <span className="font-medium">{formatINR(selectedInvoice.totalTaxableValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total CGST:</span>
                  <span className="font-medium">{formatINR(selectedInvoice.totalCGST)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total SGST:</span>
                  <span className="font-medium">{formatINR(selectedInvoice.totalSGST)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total IGST:</span>
                  <span className="font-medium">{formatINR(selectedInvoice.totalIGST)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Discount:</span>
                  <span className="font-medium">{formatINR(selectedInvoice.totalDiscount)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Grand Total:</span>
                  <span>{formatINR(selectedInvoice.grandTotal)}</span>
                </div>
              </div>
            </div>

            {/* Amount in Words */}
            <div className="mt-6 p-4 bg-muted/50 rounded">
              <p className="text-sm">
                <span className="font-medium">Amount in words:</span> {selectedInvoice.totalInWords}
              </p>
            </div>

            {/* QR Code Placeholder */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-white border rounded-lg">
                  <QrCode className="w-16 h-16 text-gray-800" />
                </div>
                <div className="text-sm text-muted-foreground">
                  <p>Scan for GST compliance</p>
                  <p className="text-xs">e-Invoice enabled</p>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>Generated by OMSKing</p>
                <p>Leheriya Creations Pvt Ltd</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-6">
            <Button variant="outline" onClick={handleDownloadPDF}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button variant="outline" onClick={handleSendWhatsApp}>
              <Send className="w-4 h-4 mr-2" />
              Send via WhatsApp
            </Button>
            <Button variant="outline" onClick={handleSendEmail}>
              <FileText className="w-4 h-4 mr-2" />
              Email to Customer
            </Button>
          </div>
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}