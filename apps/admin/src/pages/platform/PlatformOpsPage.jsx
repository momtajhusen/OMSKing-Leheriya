import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { SUBSCRIPTION_PLANS } from '../../constants/channelCatalog';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Check, Plug, ListTodo, ScrollText, Settings } from 'lucide-react';

const TITLES = {
  jobs: ['System jobs', 'Retry uses the same job. A second stock reserve is not created.'],
  logs: ['Error logs', 'Failed jobs only. Tokens and webhook secrets are not shown on the row.'],
  settings: ['Platform settings', 'OMSKing Gmail for client OTP, trial length, and order sync. Merchant GST and channel keys stay on each company.'],
  plans: ['Plans', 'What a new subscriber gets. Change a live tenant’s plan from Subscribers.'],
  health: ['Subscribers', 'Merchant status from the tenants API. Channel health is inside each tenant.'],
};

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function PlatformOpsPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mode = pathname.endsWith('/jobs')
    ? 'jobs'
    : pathname.endsWith('/logs')
      ? 'logs'
      : pathname.endsWith('/settings')
        ? 'settings'
        : pathname.endsWith('/plans')
          ? 'plans'
          : 'health';

  const [title, subtitle] = TITLES[mode];
  const [tenants, setTenants] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(mode === 'health' || mode === 'jobs' || mode === 'logs' || mode === 'settings');
  const [retrying, setRetrying] = useState('');
  const [settingsForm, setSettingsForm] = useState(null);
  const [mailStatus, setMailStatus] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingMail, setTestingMail] = useState(false);

  useEffect(() => {
    if (mode === 'settings') {
      let alive = true;
      setLoading(true);
      api.get('/tenants/ops/settings')
        .then(({ data }) => {
          if (!alive) return;
          const row = data.data || {};
          setMailStatus(row);
          setSettingsForm({
            gmailUser: row.gmailUser || '',
            gmailAppPassword: '',
            fromName: row.fromName || 'OMSKing',
            emailBrand: row.emailBrand || 'OMSKing',
            trialDays: row.trialDays || 14,
            orderPullMinutes: row.orderPullMinutes || 15,
            publicAppUrl: row.publicAppUrl || '',
          });
        })
        .catch((err) => toast.error(apiError(err, 'Could not load platform settings')))
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }
    if (mode !== 'health' && mode !== 'jobs' && mode !== 'logs') return undefined;
    let alive = true;
    const path = mode === 'jobs' ? '/tenants/ops/jobs' : mode === 'logs' ? '/tenants/ops/logs' : '/tenants';
    setLoading(true);
    api.get(path)
      .then(({ data }) => {
        if (!alive) return;
        if (mode === 'health') setTenants(data.data || []);
        else setJobs(data.data || []);
      })
      .catch((err) => toast.error(apiError(err, 'Could not load platform ops')))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mode]);

  const retryJob = async (row) => {
    setRetrying(row.id);
    try {
      await api.post(`/tenants/ops/jobs/${row.id}/retry`);
      toast.success('Job requeued. The same job is used, so stock is not reserved again.');
      setJobs((current) => current.map((job) => (job.id === row.id ? { ...job, status: 'queued', lastError: '' } : job)));
    } catch (err) {
      toast.error(apiError(err, 'Could not retry the job'));
    } finally {
      setRetrying('');
    }
  };

  return (
    <PlatformPage title={title} subtitle={subtitle}>
      {mode === 'health' && (
        loading ? <PageLoader label="Loading subscribers..." /> : !tenants.length ? (
          <EmptyState
            icon={<Plug className="h-7 w-7 text-muted-foreground" />}
            title="No merchants yet"
            description="Create a subscriber on /platform/tenants."
            action={<Button variant="outline" onClick={() => navigate('/platform/tenants')}>Manage subscribers</Button>}
          />
        ) : (
          <PlatformSheet>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Last sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.plan}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'Suspended' ? 'destructive' : 'outline'}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>{(row.channels || []).join(', ') || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{when(row.lastSync)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PlatformSheet>
        )
      )}

      {mode === 'jobs' && (
        loading ? <PageLoader label="Loading jobs..." /> : !jobs.length ? (
          <EmptyState
            icon={<ListTodo className="h-7 w-7 text-muted-foreground" />}
            title="No jobs yet"
            description="Channel pulls and inventory jobs appear here. Retry uses the same job, so a reserve is not created again."
          />
        ) : (
          <PlatformSheet>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.tenantName || '—'}</TableCell>
                    <TableCell>{row.channel} · {row.jobType}</TableCell>
                    <TableCell><Badge variant={row.status === 'failed' ? 'destructive' : 'outline'}>{row.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{when(row.finishedAt || row.createdAt)}</TableCell>
                    <TableCell className="max-w-[18rem] whitespace-normal text-sm">{row.lastError || row.shortSummary || '—'}</TableCell>
                    <TableCell>
                      {row.status === 'failed' && (
                        <Button size="sm" variant="outline" disabled={retrying === row.id} onClick={() => retryJob(row)}>
                          {retrying === row.id ? 'Retrying…' : 'Retry'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PlatformSheet>
        )
      )}

      {mode === 'logs' && (
        loading ? <PageLoader label="Loading logs..." /> : !jobs.length ? (
          <EmptyState
            icon={<ScrollText className="h-7 w-7 text-muted-foreground" />}
            title="No failed jobs"
            description="Adapter errors show here. Tokens and webhook secrets are not stored on the row."
          />
        ) : (
          <PlatformSheet>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">{when(row.finishedAt || row.createdAt)}</TableCell>
                    <TableCell className="font-medium">{row.tenantName || '—'}</TableCell>
                    <TableCell>{row.channel} · {row.jobType}</TableCell>
                    <TableCell className="max-w-[24rem] whitespace-normal text-sm">{row.lastError || row.shortSummary || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PlatformSheet>
        )
      )}

      {mode === 'settings' && (
        loading || !settingsForm ? <PageLoader label="Loading platform settings..." /> : (
          <form
            className="premium-card max-w-xl space-y-4 p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setSavingSettings(true);
              try {
                const payload = { ...settingsForm, trialDays: Number(settingsForm.trialDays), orderPullMinutes: Number(settingsForm.orderPullMinutes) };
                if (!payload.gmailAppPassword) delete payload.gmailAppPassword;
                const { data } = await api.patch('/tenants/ops/settings', payload);
                setMailStatus(data.data);
                setSettingsForm((current) => ({ ...current, gmailAppPassword: '' }));
                toast.success('Platform settings saved');
              } catch (err) {
                toast.error(apiError(err, 'Could not save platform settings'));
              } finally {
                setSavingSettings(false);
              }
            }}
          >
            <div className="flex gap-3">
              <Settings className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">Client OTP mailbox</p>
                <p className="text-muted-foreground">
                  {mailStatus?.mailSource === 'panel' && `New-seller OTP and welcome mail send from ${mailStatus.activeGmail}.`}
                  {mailStatus?.mailSource === 'env' && `Still using the server mailbox ${mailStatus.activeGmail}. Save a Gmail here to manage it from this panel.`}
                  {mailStatus?.mailSource === 'missing' && 'No Gmail is set, so a new seller cannot finish signup.'}
                </p>
              </div>
            </div>
            <label className="block text-sm font-medium">
              Gmail address
              <input className="premium-input mt-1.5" type="email" autoComplete="off" value={settingsForm.gmailUser} onChange={(event) => setSettingsForm({ ...settingsForm, gmailUser: event.target.value })} placeholder="otp@yourdomain.com" />
            </label>
            <label className="block text-sm font-medium">
              Gmail app password
              <input className="premium-input mt-1.5" type="password" autoComplete="new-password" value={settingsForm.gmailAppPassword} onChange={(event) => setSettingsForm({ ...settingsForm, gmailAppPassword: event.target.value })} placeholder={mailStatus?.panelMailReady ? 'Saved. Leave blank to keep it.' : 'Google App Password'} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Sender name
                <input className="premium-input mt-1.5" value={settingsForm.fromName} onChange={(event) => setSettingsForm({ ...settingsForm, fromName: event.target.value })} />
              </label>
              <label className="block text-sm font-medium">
                Email footer
                <input className="premium-input mt-1.5" value={settingsForm.emailBrand} onChange={(event) => setSettingsForm({ ...settingsForm, emailBrand: event.target.value })} />
              </label>
              <label className="block text-sm font-medium">
                Trial length (days)
                <input className="premium-input mt-1.5" type="number" min="1" max="90" value={settingsForm.trialDays} onChange={(event) => setSettingsForm({ ...settingsForm, trialDays: event.target.value })} />
              </label>
              <label className="block text-sm font-medium">
                Order sync every (minutes)
                <input className="premium-input mt-1.5" type="number" min="1" max="1440" value={settingsForm.orderPullMinutes} onChange={(event) => setSettingsForm({ ...settingsForm, orderPullMinutes: event.target.value })} />
              </label>
            </div>
            <label className="block text-sm font-medium">
              App link in emails
              <input className="premium-input mt-1.5" value={settingsForm.publicAppUrl} onChange={(event) => setSettingsForm({ ...settingsForm, publicAppUrl: event.target.value })} placeholder="https://omsking.codersalpha.com" />
            </label>
            <p className="text-xs text-muted-foreground">A company that has saved its own Gmail still sends that company’s password reset and sign-in OTP. This mailbox is for new sellers and for mail before a company Gmail exists. Access tokens stay 15 minutes.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save settings'}</Button>
              <Button
                type="button"
                variant="outline"
                disabled={testingMail}
                onClick={async () => {
                  setTestingMail(true);
                  try {
                    const { data } = await api.post('/tenants/ops/settings/test-mail');
                    toast.success(`Test email sent to ${data.data.sentTo}`);
                  } catch (err) {
                    toast.error(apiError(err, 'Could not send the test email'));
                  } finally {
                    setTestingMail(false);
                  }
                }}
              >
                {testingMail ? 'Sending…' : 'Send test email'}
              </Button>
            </div>
          </form>
        )
      )}

      {mode === 'plans' && (
        <div className="grid gap-4 md:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div key={plan.id} className={`premium-card p-6 ${plan.id === 'growth' ? 'ring-2 ring-emerald-500/40' : ''}`}>
              {plan.id === 'growth' && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Default for new trials</p>}
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
    </PlatformPage>
  );
}
