import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { webhookEvents as seed } from '../../mocks/webhooks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { RefreshCw } from 'lucide-react';

export default function WebhooksPage() {
  const [rows, setRows] = useState(seed);

  const retry = (row) => {
    if (row.duplicate) {
      toast.error('Duplicate webhook — no second Master Order or reservation');
      return;
    }
    setRows((prev) =>
      prev.map((item) => (item.id === row.id ? { ...item, status: 'processed' } : item))
    );
    toast.success(`Replay ${row.id} (${row.correlationId}) — same idempotency key`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Webhooks</h1>
        <p className="text-muted-foreground">
          Ingest history with X-Idempotency-Key. Same channel order twice never creates two Master Orders.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
          <CardDescription>Failed rows retry with backoff; dead-letter stays until manual replay.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Channel order</TableHead>
                <TableHead>Idempotency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.id}</TableCell>
                  <TableCell>{row.channel}</TableCell>
                  <TableCell className="font-mono text-xs">{row.topic}</TableCell>
                  <TableCell>{row.channelOrderId}</TableCell>
                  <TableCell className="font-mono text-xs">{row.idempotencyKey}</TableCell>
                  <TableCell>
                    <Badge variant={row.duplicate ? 'secondary' : row.status === 'processed' ? 'outline' : 'destructive'}>
                      {row.duplicate ? 'duplicate ignored' : row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {(row.status === 'failed' || row.status === 'dead_letter') && (
                      <Button size="sm" variant="outline" onClick={() => retry(row)}>
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Retry
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
