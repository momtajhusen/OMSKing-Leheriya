import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { RefreshCw } from 'lucide-react';

function statusVariant(status) {
  if (status === 'processed') return 'outline';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

export default function WebhooksPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await api.get('/integrations/webhooks');
    setRows(data.data || []);
  };

  useEffect(() => {
    load()
      .catch((err) => toast.error(apiError(err, 'Could not load webhooks')))
      .finally(() => setLoading(false));
  }, []);

  const retry = async (row) => {
    try {
      await api.post(`/integrations/webhooks/${row.id}/retry`);
      toast.success('Webhook requeued. The same event will not be applied twice.');
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Retry failed'));
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Webhooks</h1>
        <p className="text-muted-foreground">
          Inbox for Shopify, Amazon, and Myntra. POST /api/v1/integrations/shopify/webhook (amazon and myntra use the same path). The shop signature picks the tenant. The same event id is stored once and is not applied again. A public HTTPS host is required; localhost does not receive channel webhooks.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
          <CardDescription>Failed rows can be retried. A duplicate delivery stays on the original row.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading webhooks…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No webhooks yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Event id</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead>Duplicates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.channel}</TableCell>
                    <TableCell className="font-mono text-xs">{row.topic || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.externalEventId}</TableCell>
                    <TableCell className="font-mono text-xs">{row.correlationId}</TableCell>
                    <TableCell>{row.duplicateCount || 0}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.status === 'failed' && (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
