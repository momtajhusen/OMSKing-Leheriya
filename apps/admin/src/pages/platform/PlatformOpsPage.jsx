import { useLocation } from 'react-router-dom';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { toast } from 'react-hot-toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { SUBSCRIPTION_PLANS } from '../../mocks/channels';
import { DEMO_ACCOUNTS } from '../../mocks/platform';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import { Check } from 'lucide-react';

const JOBS = [
  { id: 'JOB-101', type: 'orders_pull', channel: 'Shopify', status: 'success', at: '2 min ago' },
  { id: 'JOB-102', type: 'inventory_push', channel: 'Amazon', status: 'failed', at: '11 min ago' },
  { id: 'JOB-103', type: 'webhook', channel: 'Myntra', status: 'queued', at: '18 min ago' },
];

const HEALTH = [
  { name: 'Shopify', state: 'Connected', lastOk: '1 min ago', lastFail: '—' },
  { name: 'Amazon SP-API', state: 'Degraded', lastOk: '22 min ago', lastFail: 'Rate limit' },
  { name: 'Myntra Partner', state: 'Connected', lastOk: '4 min ago', lastFail: '—' },
];

const TITLES = {
  jobs: ['System jobs', 'Queue work must not block the merchant UI. Retry never duplicates a Master Order.'],
  logs: ['Error logs', 'Correlation IDs on every adapter call. Dead-letter until replay.'],
  settings: ['Platform settings', 'Session TTL and flags live here. Merchant GST stays in the tenant.'],
  plans: ['Plans', 'Add-on billing for future SaaS subscribers — Leheriya is tenant one.'],
  users: ['Platform users', 'OMSKing staff only. Impersonation is from Subscribers.'],
  health: ['Integration health', 'Last sync and failures. Manual retry does not create a second order.'],
};

export default function PlatformOpsPage() {
  const { pathname } = useLocation();
  const mode = pathname.endsWith('/jobs')
    ? 'jobs'
    : pathname.endsWith('/logs')
      ? 'logs'
      : pathname.endsWith('/settings')
        ? 'settings'
        : pathname.endsWith('/plans')
          ? 'plans'
          : pathname.endsWith('/users')
            ? 'users'
            : 'health';

  const [title, subtitle] = TITLES[mode];

  return (
    <PlatformPage title={title} subtitle={subtitle}>
      {mode === 'health' && (
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Integration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last OK</TableHead>
                <TableHead>Last fail</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {HEALTH.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${row.state === 'Connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <Badge variant="outline">{row.state}</Badge>
                    </span>
                  </TableCell>
                  <TableCell>{row.lastOk}</TableCell>
                  <TableCell>{row.lastFail}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => toast.success(`Retry queued for ${row.name}`)}>Retry</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      )}

      {mode === 'jobs' && (
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {JOBS.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.id}</TableCell>
                  <TableCell className="font-mono text-xs">{job.type}</TableCell>
                  <TableCell>{job.channel}</TableCell>
                  <TableCell>
                    <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>{job.status}</Badge>
                  </TableCell>
                  <TableCell>{job.at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      )}

      {mode === 'logs' && (
        <div className="premium-card space-y-3 p-6">
          <p className="font-mono text-sm">corr-9f2a · Amazon inventory_push · rate limit</p>
          <p className="text-sm text-muted-foreground">No second reservation written. Replay from dead-letter when SP-API is healthy.</p>
          <Button variant="outline" size="sm" onClick={() => toast.success('Replay queued (dummy)')}>Replay</Button>
        </div>
      )}

      {mode === 'settings' && (
        <div className="premium-card max-w-lg space-y-4 p-6">
          <label className="block text-sm">
            <span className="font-medium">Access token TTL</span>
            <p className="text-muted-foreground">15 minutes (JWT). Refresh cookie 7 days.</p>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Feature: new-channel waitlist</span>
            <input type="checkbox" defaultChecked className="h-4 w-4" />
          </label>
          <Button variant="outline" onClick={() => toast.success('Platform settings saved (dummy)')}>Save</Button>
        </div>
      )}

      {mode === 'plans' && (
        <div className="grid gap-4 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div key={plan.id} className={`premium-card p-6 ${plan.id === 'growth' ? 'ring-2 ring-emerald-500/40' : ''}`}>
              {plan.id === 'growth' && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Leheriya launch</p>}
              <h2 className="text-xl font-bold">{plan.name}</h2>
              <p className="mt-1 text-2xl font-semibold text-emerald-700">{plan.price}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Channels: {plan.channelLimit ?? 'Unlimited'}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {mode === 'users' && (
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_ACCOUNTS.filter((a) => a.role === 'platform_admin').map((a) => (
                <TableRow key={a.email}>
                  <TableCell>{a.email}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell><Badge variant="outline">platform_admin</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      )}
    </PlatformPage>
  );
}
