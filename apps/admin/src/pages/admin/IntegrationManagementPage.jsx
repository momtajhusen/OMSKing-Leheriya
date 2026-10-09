import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';
import api, { apiError } from '../../lib/api';
import useChannelStore from '../../stores/channelStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Plug, RefreshCw, Settings } from 'lucide-react';

const LIVE = new Set(['shopify', 'amazon', 'myntra']);

function when(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}

export default function IntegrationManagementPage() {
  const catalog = useChannelStore((s) => s.catalog);
  const enabledIds = useChannelStore((s) => s.enabledIds);
  const connections = useChannelStore((s) => s.connections);
  const hydrateFromServer = useChannelStore((s) => s.hydrateFromServer);
  const [jobs, setJobs] = useState([]);
  const [queueEngine, setQueueEngine] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyChannel, setBusyChannel] = useState('');

  const load = async () => {
    const [channelRes, jobRes] = await Promise.all([
      api.get('/channels'),
      api.get('/integrations/jobs'),
    ]);
    hydrateFromServer(channelRes.data?.data || []);
    setJobs(jobRes.data?.data || []);
    setQueueEngine(jobRes.data?.meta?.queue || '');
  };

  useEffect(() => {
    load()
      .catch((err) => toast.error(apiError(err, 'Could not load integrations')))
      .finally(() => setLoading(false));
  }, []);

  const integrations = catalog
    .filter((c) => enabledIds.includes(c.id))
    .map((c) => {
      const failedJobs = jobs.filter((job) => job.channel === c.id && job.status === 'failed').length;
      const latest = jobs.find((job) => job.channel === c.id && job.status === 'success');
      return {
        ...c,
        ...(connections[c.id] || { status: 'not_configured' }),
        failedJobs,
        lastSync: latest?.finishedAt || null,
      };
    });

  const syncNow = async (integration) => {
    if (!LIVE.has(integration.id)) {
      toast.error('Sync queue is available for Shopify, Amazon, and Myntra');
      return;
    }
    setBusyChannel(integration.id);
    try {
      await api.post('/integrations/jobs', { channel: integration.id, jobType: 'orders_pull' });
      toast.success(`orders_pull queued for ${integration.name}`);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not queue sync'));
    } finally {
      setBusyChannel('');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Integration Management</h1>
          <p className="text-muted-foreground">
            Health for the channels this tenant selected. Sync Now pulls orders only when that channel's orders API is connected.
          </p>
        </div>
        <Link to="/channels">
          <Button>
            <Settings className="w-4 h-4 mr-2" />
            Select channels & API
          </Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading integrations…</p>
      ) : integrations.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No channels selected yet.{' '}
            <Link to="/channels" className="text-primary underline">
              Choose marketplaces
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {integrations.map((integration) => (
            <Card key={integration.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plug className="w-5 h-5" />
                  {integration.name}
                </CardTitle>
                <CardDescription>
                  <Badge variant={integration.status === 'connected' ? 'outline' : 'secondary'}>
                    {integration.status || 'not_configured'}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last Sync</span>
                  <span>{when(integration.lastSync)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Failed Jobs</span>
                  <span className={integration.failedJobs > 0 ? 'text-destructive' : ''}>
                    {integration.failedJobs}
                  </span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={busyChannel === integration.id}
                    onClick={() => syncNow(integration)}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Sync Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Job queue</CardTitle>
          <CardDescription>
            orders_pull, inventory_push, and webhook_dispatch on {queueEngine === 'bullmq' ? 'Redis / BullMQ' : 'the Mongo poller'}. A restarted worker retries a job once. The side effect still runs once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.channel}</TableCell>
                    <TableCell className="font-mono text-xs">{job.jobType}</TableCell>
                    <TableCell>
                      <Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'success' ? 'outline' : 'secondary'}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{job.retriesCount}</TableCell>
                    <TableCell className="text-sm">{job.lastError || job.shortSummary || '—'}</TableCell>
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
