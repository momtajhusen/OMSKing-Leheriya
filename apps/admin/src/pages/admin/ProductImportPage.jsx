import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Upload, ArrowRight } from 'lucide-react';

const STEPS = [
  { id: 'shopify', name: 'Shopify', hint: 'Import first. Same SKU later auto-maps Amazon/Myntra.' },
  { id: 'myntra', name: 'Myntra', hint: 'Second. Match Master SKU if Shopify already has it.' },
  { id: 'amazon', name: 'Amazon', hint: 'Last. Unmatched rows go to Unmapped Listings.' },
];

const SAMPLE = [
  { sku: 'LHK-BL-001', title: 'Leheriya Kurta Blue', channel: 'Shopify', result: 'created Master SKU' },
  { sku: 'LHK-BL-001', title: 'Leheriya Kurta Blue', channel: 'Myntra', result: 'auto-mapped' },
  { sku: 'AMZ-NEW-009', title: 'Festival Dupatta', channel: 'Amazon', result: 'unmapped queue' },
];

export default function ProductImportPage() {
  const [done, setDone] = useState({});

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Bulk product import</h1>
        <p className="text-muted-foreground">
          New tenant: Shopify, then Myntra, then Amazon. Same SKU across channels maps to one Master SKU.
        </p>
      </div>

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
            <CardContent>
              <Button
                className="w-full"
                variant={done[step.id] ? 'outline' : 'default'}
                onClick={() => {
                  setDone((prev) => ({ ...prev, [step.id]: true }));
                  toast.success(`${step.name} catalog queued`);
                }}
              >
                <Upload className="w-4 h-4 mr-2" />
                {done[step.id] ? 'Re-import' : 'Upload CSV / pull API'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last dummy run</CardTitle>
          <CardDescription>Auto-map vs Unmapped Listings (SKU Mapping).</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE.map((row) => (
                <TableRow key={`${row.channel}-${row.sku}`}>
                  <TableCell className="font-medium">{row.sku}</TableCell>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.channel}</TableCell>
                  <TableCell><Badge variant="outline">{row.result}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground mt-4 flex items-center gap-1">
            Next <ArrowRight className="w-4 h-4" /> Unmapped Listings on SKU Mapping
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
