import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import { statusBadgeVariant } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_LABELS } from '../../constants/roles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage } from '../../components/platform/PlatformChrome';
import { Shield, Users, Key, Clock, Search, Plus } from 'lucide-react';

export default function AuthPage({ scope = 'tenant' }) {
  const { user } = useAuth();
  const isPlatform = scope === 'platform' || user?.role === ROLES.PLATFORM_ADMIN;
  const [activeTab, setActiveTab] = useState(isPlatform ? 'sessions' : 'users');
  const [query, setQuery] = useState('');
  const [sessionList, setSessionList] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [resets, setResets] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [issuedSecret, setIssuedSecret] = useState('');
  const [twoFa, setTwoFa] = useState(Boolean(user?.twoFactorEnabled));
  const [twoFaPending, setTwoFaPending] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const jobs = [
          api.get('/sessions'),
          api.get('/auth/password-resets'),
          isPlatform ? Promise.resolve({ data: { data: [] } }) : api.get('/users'),
        ];
        if (!isPlatform) jobs.push(api.get('/settings/api-keys'));
        const [sess, resetRes, usersRes, keysRes] = await Promise.all(jobs);
        if (cancelled) return;
        setSessionList(sess.data.data || []);
        setResets(resetRes.data.data || []);
        setDirectory(usersRes.data.data || []);
        setApiKeys(keysRes?.data?.data || []);
        setTwoFa(Boolean(user?.twoFactorEnabled));
      } catch (err) {
        toast.error(apiError(err, 'Could not load auth data'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isPlatform, user?.twoFactorEnabled]);

  const visibleSessions = useMemo(() => {
    const list = isPlatform ? sessionList : sessionList.filter((s) => s.tenant === (user?.tenantName || 'Leheriya Creations'));
    const q = query.toLowerCase();
    return list.filter((s) => !q || s.user.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [sessionList, isPlatform, user, query]);

  const tabs = isPlatform
    ? [
        { id: 'sessions', label: 'Sessions', icon: Clock },
        { id: 'password-resets', label: 'Password Resets', icon: Key },
        { id: '2fa', label: '2FA', icon: Shield },
      ]
    : [
        { id: 'users', label: 'Directory', icon: Users },
        { id: 'sessions', label: 'Sessions', icon: Clock },
        { id: 'password-resets', label: 'Password Resets', icon: Key },
        { id: 'api-keys', label: 'API Keys', icon: Shield },
        { id: '2fa', label: '2FA', icon: Shield },
      ];

  if (loading) return <PageLoader label="Loading authentication..." />;

  const heading = (
    <>
      <h1 className="text-xl font-bold">Authentication</h1>
      <p className="text-muted-foreground">
        {isPlatform
          ? 'Platform-wide sessions and password resets across every subscriber.'
          : `JWT access (15 min) + refresh cookie (7 days) for ${user?.tenantName || 'this tenant'}.`}
      </p>
    </>
  );

  const body = (
    <>

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle>User directory</CardTitle>
            <CardDescription>Full invite and role edits live under Users & Roles.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directory.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell><Badge variant="outline">{ROLE_LABELS[row.role] || row.role}</Badge></TableCell>
                    <TableCell><Badge variant={row.status === 'Active' ? 'outline' : 'secondary'}>{row.status}</Badge></TableCell>
                    <TableCell>{row.lastLogin}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'sessions' && (
        <Card>
          <CardHeader>
            <CardTitle>Sessions ({visibleSessions.filter((s) => s.status === 'Active').length} active)</CardTitle>
            <CardDescription>Revoke bumps refreshTokenVersion and signs that device out.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                placeholder="Search sessions..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  {isPlatform && <TableHead>Tenant</TableHead>}
                  <TableHead>Role</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="font-medium">{session.user}</div>
                      <div className="text-xs text-muted-foreground">{session.email}</div>
                    </TableCell>
                    {isPlatform && <TableCell>{session.tenant}</TableCell>}
                    <TableCell><Badge variant="outline">{session.role}</Badge></TableCell>
                    <TableCell>{session.device}</TableCell>
                    <TableCell className="font-mono text-xs">{session.ip}</TableCell>
                    <TableCell>{session.lastActive}</TableCell>
                    <TableCell>
                      <Badge variant={session.status === 'Active' ? 'outline' : 'secondary'}>{session.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {session.status === 'Active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={async () => {
                            try {
                              await api.delete(`/sessions/${session.id}`);
                              setSessionList((prev) => prev.map((item) => (item.id === session.id ? { ...item, status: 'Revoked' } : item)));
                              toast.success(`Session revoked for ${session.user}`);
                            } catch (err) {
                              toast.error(apiError(err));
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'password-resets' && (
        <Card>
          <CardHeader>
            <CardTitle>Password resets</CardTitle>
            <CardDescription>Gmail OTP expires in 10 minutes. Completing a reset kills all old sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resets.map((reset) => (
                  <TableRow key={reset.id}>
                    <TableCell className="font-medium">{reset.user}</TableCell>
                    <TableCell>{reset.email}</TableCell>
                    <TableCell>{reset.requestedAt ? new Date(reset.requestedAt).toLocaleString() : '—'}</TableCell>
                    <TableCell>{reset.expiresAt ? new Date(reset.expiresAt).toLocaleString() : '—'}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(reset.status)}>{reset.status}</Badge></TableCell>
                    <TableCell>
                      {reset.status === 'Pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await api.post('/auth/forgot-password', { email: reset.email });
                              toast.success(`OTP resent to ${reset.email}`);
                            } catch (err) {
                              toast.error(apiError(err));
                            }
                          }}
                        >
                          Resend link
                        </Button>
                      ) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'api-keys' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>API keys</CardTitle>
              <CardDescription>Full secret is shown once at creation.</CardDescription>
            </div>
            <Button size="sm" onClick={() => { setKeyLabel(''); setIssuedSecret(''); setKeyOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              New key
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.label}</TableCell>
                    <TableCell className="font-mono text-xs">{key.prefix}</TableCell>
                    <TableCell>{key.scope}</TableCell>
                    <TableCell>{key.lastUsed}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(key.status)}>{key.status}</Badge></TableCell>
                    <TableCell>
                      {key.status === 'Active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={async () => {
                            try {
                              await api.post(`/settings/api-keys/${key.id}/revoke`);
                              setApiKeys((prev) => prev.map((item) => (item.id === key.id ? { ...item, status: 'Inactive' } : item)));
                              toast.success(`${key.label} revoked`);
                            } catch (err) {
                              toast.error(apiError(err, 'Could not revoke key'));
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === '2fa' && (
        <Card>
          <CardHeader>
            <CardTitle>Sign-in OTP</CardTitle>
            <CardDescription>
              {isPlatform
                ? 'Platform mailbox sends the code. Another company mailbox is not used.'
                : 'Uses this company’s Gmail from Settings. Until that is saved, OMSKing Gmail sends the code.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Ask for an email OTP at every sign-in</p>
              <Button
                variant={twoFa ? 'default' : 'outline'}
                onClick={async () => {
                  try {
                    if (twoFa) {
                      await api.patch('/auth/me', { twoFactorEnabled: false });
                      setTwoFa(false);
                      setOtpCode('');
                      toast.success('Sign-in OTP is off');
                      return;
                    }
                    await api.post('/auth/2fa/start');
                    setOtpCode('');
                    setTwoFaPending(true);
                    toast.success('OTP sent to your email');
                  } catch (err) {
                    toast.error(apiError(err));
                  }
                }}
              >
                {twoFa ? 'Turn off' : 'Send OTP to turn on'}
              </Button>
            </div>
            {twoFaPending && !twoFa && (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!/^\d{6}$/.test(otpCode.trim())) {
                    toast.error('Enter the 6-digit OTP from Gmail');
                    return;
                  }
                  try {
                    await api.post('/auth/2fa/confirm', { otp: otpCode.trim() });
                    setTwoFa(true);
                    setTwoFaPending(false);
                    toast.success('Sign-in OTP is on');
                  } catch (err) {
                    toast.error(apiError(err, 'Could not confirm the OTP'));
                  }
                }}
              >
                <Input className="h-9 w-40 tracking-[0.2em]" inputMode="numeric" maxLength={6} placeholder="123456" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} aria-label="OTP from Gmail" />
                <Button type="submit" className="h-9">Confirm OTP</Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <Modal
        open={keyOpen}
        onOpenChange={setKeyOpen}
        title="Create API key"
        footer={
          <>
            <Button variant="outline" onClick={() => setKeyOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!keyLabel.trim()) {
                  toast.error('Enter a label');
                  return;
                }
                try {
                  const { data } = await api.post('/settings/api-keys', { label: keyLabel.trim() });
                  setApiKeys((prev) => [data.data, ...prev.filter((item) => item.id !== data.data.id)]);
                  setIssuedSecret(data.data.secret || '');
                  toast.success('Key created — copy it now. It will not be shown again.');
                } catch (err) {
                  toast.error(apiError(err, 'Could not create key'));
                }
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Input placeholder="Label" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
        {issuedSecret && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted-foreground">Copy this secret. It is stored only as a hash.</p>
            <Input readOnly value={issuedSecret} onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(issuedSecret);
                toast.success('Copied');
              }}
            >
              Copy
            </Button>
          </div>
        )}
      </Modal>
    </>
  );

  if (isPlatform) {
    return (
      <PlatformPage
        title="Authentication"
        subtitle="Platform-wide sessions and password resets across every subscriber."
      >
        {body}
      </PlatformPage>
    );
  }

  return (
    <div className="space-y-3">
      <div>{heading}</div>
      {body}
    </div>
  );
}
