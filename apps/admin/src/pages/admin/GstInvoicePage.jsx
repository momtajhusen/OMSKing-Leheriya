import { useState } from 'react';
import { invoices } from '../../mocks';
import { formatINR, formatDate } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { FileText, Download, Printer, Send, Upload, Edit, QrCode } from 'lucide-react';

export default function GstInvoicePage() {
  const [selectedInvoice, setSelectedInvoice] = useState(invoices[0]);
  const [editMode, setEditMode] = useState(false);

  const handleEditHSN = () => {
    setEditMode(!editMode);
  };

  const handleUploadMasterHSN = () => {
    // Mock upload functionality
    console.log('Uploading master HSN file');
  };

  const handleDownloadPDF = () => {
    console.log('Downloading PDF for invoice:', selectedInvoice.invoiceNo);
  };

  const handlePrint = () => {
    console.log('Printing invoice:', selectedInvoice.invoiceNo);
  };

  const handleSendWhatsApp = () => {
    console.log('Sending invoice via WhatsApp:', selectedInvoice.invoiceNo);
  };

  const handleSendEmail = () => {
    console.log('Sending invoice via email:', selectedInvoice.invoiceNo);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">GST Invoice</h1>
          <p className="text-muted-foreground">Generate and manage GST invoices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleUploadMasterHSN}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Master HSN
          </Button>
          <Button onClick={handleEditHSN}>
            <Edit className="w-4 h-4 mr-2" />
            {editMode ? 'View Mode' : 'Edit HSN & GST'}
          </Button>
        </div>
      </div>

      {/* Invoice Selection Table */}
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
                  <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                  <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                  <TableCell>{invoice.orderId}</TableCell>
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
          <CardTitle>Invoice Preview - {selectedInvoice.invoiceNo}</CardTitle>
          <CardDescription>
            GST compliant invoice template with tax breakdown
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
                <p className="text-sm text-muted-foreground">{selectedInvoice.invoiceNo}</p>
                <p className="text-sm text-muted-foreground">Date: {formatDate(selectedInvoice.invoiceDate)}</p>
              </div>
              <div className="text-right">
                <h3 className="font-bold text-lg mb-2">Bill To / Ship To</h3>
                <p className="font-medium">{selectedInvoice.customerName}</p>
                <p className="text-sm text-muted-foreground">{selectedInvoice.customerAddress}</p>
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
                          defaultValue={item.hsn}
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
                          defaultValue={item.gstPercent}
                          className="w-16 px-2 py-1 border rounded text-sm"
                        />
                      ) : (
                        `${item.gstPercent}%`
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
    </div>
  );
}