import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { AUTH_SESSIONS } from '../../mocks/platform';
import { users } from '../../mocks';
import { statusBadgeVariant } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_LABELS } from '../../constants/roles';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
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
  const [sessionList, setSessionList] = useState(AUTH_SESSIONS);
  const [resets, setResets] = useState([
    { id: 'PWR-001', user: 'Anita Sharma', email: 'ops@leheriya.com', requestedAt: '2026-09-08 08:02', expiresAt: '2026-09-08 09:02', status: 'Pending' },
    { id: 'PWR-002', user: 'Sandeep Textiles', email: 'vendor@omsking.com', requestedAt: '2026-09-07 16:35', expiresAt: '2026-09-07 17:35', status: 'Completed' },
    { id: 'PWR-003', user: 'Ravi Patel', email: 'ravi@suratsilks.com', requestedAt: '2026-09-06 11:10', expiresAt: '2026-09-06 12:10', status: 'Expired' },
  ]);
  const [apiKeys, setApiKeys] = useState([
    { id: 'KEY-001', label: 'Shopify Webhook', prefix: 'shp_live_••••4f2a', scope: 'Orders, Inventory', createdAt: '2026-06-02', lastUsed: '5 min ago', status: 'Active' },
    { id: 'KEY-002', label: 'Amazon SP-API', prefix: 'amz_live_••••91cd', scope: 'Orders, Reports', createdAt: '2026-06-02', lastUsed: '22 min ago', status: 'Active' },
    { id: 'KEY-003', label: 'Myntra Partner API', prefix: 'myn_live_••••7b30', scope: 'Orders, Labels', createdAt: '2026-06-05', lastUsed: '1 hr ago', status: 'Active' },
    { id: 'KEY-004', label: 'Legacy Import Script', prefix: 'int_test_••••0ae1', scope: 'Products', createdAt: '2025-11-18', lastUsed: '3 months ago', status: 'Inactive' },
  ]);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [twoFa, setTwoFa] = useState(false);
  const loading = useSimulatedLoad(activeTab);

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
      <h1 className="text-3xl font-bold mb-2">Authentication</h1>
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
                {users.map((row) => (
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
                          onClick={() => {
                            setSessionList((prev) => prev.map((item) => (item.id === session.id ? { ...item, status: 'Revoked' } : item)));
                            toast.success(`Session revoked for ${session.user}`);
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
            <CardDescription>Single-use links expire in one hour. Completing a reset kills all old sessions.</CardDescription>
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
                    <TableCell>{reset.requestedAt}</TableCell>
                    <TableCell>{reset.expiresAt}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(reset.status)}>{reset.status}</Badge></TableCell>
                    <TableCell>
                      {reset.status === 'Pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            toast.success(`Reset link resent to ${reset.email}`);
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
            <Button size="sm" onClick={() => { setKeyLabel(''); setKeyOpen(true); }}>
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
                          onClick={() => {
                            setApiKeys((prev) => prev.map((item) => (item.id === key.id ? { ...item, status: 'Inactive' } : item)));
                            toast.success(`${key.label} revoked`);
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
            <CardTitle>Optional 2FA</CardTitle>
            <CardDescription>TOTP after JWT. Dummy toggle — live enrol is later.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Require authenticator app at login</p>
            <Button
              variant={twoFa ? 'default' : 'outline'}
              onClick={() => {
                setTwoFa((v) => !v);
                toast.success(!twoFa ? '2FA enabled for this tenant (dummy)' : '2FA off');
              }}
            >
              {twoFa ? 'Enabled' : 'Disabled'}
            </Button>
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
              onClick={() => {
                if (!keyLabel.trim()) {
                  toast.error('Enter a label');
                  return;
                }
                setApiKeys((prev) => [
                  { id: `KEY-${String(prev.length + 1).padStart(3, '0')}`, label: keyLabel, prefix: 'oms_live_••••new1', scope: 'Read', createdAt: '2026-09-08', lastUsed: 'Never', status: 'Active' },
                  ...prev,
                ]);
                toast.success('Key created — copy it now. It will not be shown again.');
                setKeyOpen(false);
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Input placeholder="Label" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
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
    <div className="p-6 space-y-6">
      <div>{heading}</div>
      {body}
    </div>
  );
}
