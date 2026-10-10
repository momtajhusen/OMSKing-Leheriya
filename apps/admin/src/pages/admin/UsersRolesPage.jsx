import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError, apiFormError } from '../../lib/api';
import { ROLES, ROLE_LABELS, MERCHANT_ASSIGNABLE_ROLES } from '../../constants/roles';
import { PERMISSION_CATALOG, hasPermission } from '../../constants/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { inviteUserSchema } from '../../lib/validation';
import { FormBanner } from '../../components/ui/FormBanner';
import { Users, Shield, Plus, Search, Check, X, Copy, Pencil } from 'lucide-react';
import Pagination, { useClientPage } from '../../components/ui/Pagination';

const emptyUser = { name: '', email: '', role: ROLES.OPERATIONS };
const MATRIX_ROLES = MERCHANT_ASSIGNABLE_ROLES.filter((role) => role !== ROLES.ADMIN);

export default function UsersRolesPage() {
  const { canUsers } = usePermissions();
  const [activeTab, setActiveTab] = useState('users');
  const [userList, setUserList] = useState([]);
  const [roles, setRoles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyUser);
  const [formErrors, setFormErrors] = useState({});
  const [formBanner, setFormBanner] = useState('');
  const [inviteSecret, setInviteSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roleEdit, setRoleEdit] = useState(null);
  const [rolePerms, setRolePerms] = useState([]);
  const [roleBusy, setRoleBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.get('/users'),
        api.get('/roles'),
      ]);
      setUserList(usersRes.data.data || []);
      setRoles(rolesRes.data.data || []);
    } catch (err) {
      toast.error(apiError(err, 'Could not load users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => userList.filter((item) => {
    const q = searchQuery.toLowerCase();
    const label = ROLE_LABELS[item.role] || item.role;
    return !q || item.name.toLowerCase().includes(q) || item.email.toLowerCase().includes(q) || label.toLowerCase().includes(q);
  }), [userList, searchQuery]);
  const paged = useClientPage(filtered);

  const saveUser = async () => {
    setFormBanner('');
    const parsed = inviteUserSchema.safeParse(form);
    if (!parsed.success) {
      const next = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path[0];
        if (key && !next[key]) next[key] = issue.message;
      });
      setFormErrors(next);
      setFormBanner('Please fix the highlighted fields.');
      return;
    }
    setFormErrors({});
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, parsed.data);
        toast.success(`${parsed.data.name} updated`);
      } else {
        const { data } = await api.post('/users', parsed.data);
        const temp = data.data?.temporaryPassword;
        setInviteSecret({
          email: parsed.data.email,
          temporaryPassword: temp || null,
          emailSent: Boolean(data.data?.emailSent),
        });
        toast.success(`Invite created for ${parsed.data.email}`);
        load();
        return;
      }
      setOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      const apiParsed = apiFormError(err);
      setFormErrors(apiParsed.fields);
      setFormBanner(apiParsed.message === 'Validation failed' ? 'Please fix the highlighted fields.' : apiParsed.message);
    }
  };

  const toggleStatus = async (row) => {
    const next = row.status === 'Active' ? 'disabled' : 'active';
    try {
      await api.patch(`/users/${row.id}/status`, { status: next });
      toast.success(`${row.name} updated`);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const saveRolePermissions = async (role, next) => {
    const locked = role.code === ROLES.SUPER_ADMIN && !next.includes('users.manage')
      ? [...next, 'users.manage']
      : next;
    try {
      await api.patch(`/roles/${role.id}`, { permissions: locked });
      setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, permissions: locked } : r)));
      toast.success(`${ROLE_LABELS[role.code] || role.name} permissions saved`);
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  const togglePerm = async (role, key) => {
    if (role.code === ROLES.SUPER_ADMIN && key === 'users.manage' && role.permissions.includes(key)) {
      toast.error('Merchant Super Admin must keep Manage users');
      return;
    }
    if (role.code === ROLES.VENDOR && (key === 'users.manage' || key === 'finance.reconcile') && !role.permissions.includes(key)) {
      toast.error('Vendor cannot manage users or reconcile finance');
      return;
    }
    const next = role.permissions.includes(key)
      ? role.permissions.filter((p) => p !== key)
      : [...role.permissions, key];
    await saveRolePermissions(role, next);
  };

  const openRoleEdit = (code) => {
    const role = roles.find((r) => r.code === code);
    if (!role) {
      toast.error('Role is not seeded on this tenant yet');
      return;
    }
    setRoleEdit(role);
    setRolePerms([...(role.permissions || [])]);
  };

  if (loading) return <PageLoader label="Loading users & roles..." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Users & Roles</h1>
          <p className="text-muted-foreground">
            Permissions are checked as keys (orders.view, finance.reconcile, …) — not by role title alone. This tenant cannot see another merchant. Platform Admin is not assigned here.
          </p>
        </div>
        {canUsers && (
          <Button onClick={() => { setEditing(null); setInviteSecret(null); setForm(emptyUser); setFormErrors({}); setFormBanner(''); setOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        {[
          { id: 'users', label: 'Users', icon: Users },
          { id: 'roles', label: 'Roles & Permissions', icon: Shield },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle>Tenant users</CardTitle>
            <CardDescription>Merchant Super Admin, Operations, Warehouse, Accounts, Catalog, Support, Vendor.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search users..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {filtered.length === 0 ? (
              <EmptyState title="No users match" />
            ) : (
              <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell><Badge variant="outline">{ROLE_LABELS[row.role] || row.role}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'Active' ? 'outline' : 'secondary'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>{row.lastLogin}</TableCell>
                      <TableCell>
                        {canUsers ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => { setEditing(row); setInviteSecret(null); setForm({ name: row.name, email: row.email, role: row.role }); setFormErrors({}); setFormBanner(''); setOpen(true); }}>Edit</Button>
                            <Button variant="ghost" size="sm" onClick={() => toggleStatus(row)}>
                              {row.status === 'Active' ? 'Disable' : 'Enable'}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">View only</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={paged.page} total={paged.total} limit={paged.limit} onPage={paged.setPage} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'roles' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Permission matrix</CardTitle>
              <CardDescription>Click a check to grant or revoke, or Edit on a role to change every permission at once.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Permission</TableHead>
                    {MATRIX_ROLES.map((role) => (
                      <TableHead key={role} className="text-center whitespace-nowrap text-xs">
                        <div>{ROLE_LABELS[role]}</div>
                        {canUsers && (
                          <button
                            type="button"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            onClick={() => openRoleEdit(role)}
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PERMISSION_CATALOG.map((perm) => (
                    <TableRow key={perm.key}>
                      <TableCell>
                        <div className="font-medium">{perm.label}</div>
                        <code className="text-[11px] text-muted-foreground">{perm.key}</code>
                      </TableCell>
                    {MATRIX_ROLES.map((code) => {
                      const role = roles.find((r) => r.code === code);
                      const granted = role?.permissions || [];
                      return (
                        <TableCell key={code} className="text-center">
                          <button
                            type="button"
                            className="mx-auto block rounded p-1 hover:bg-muted disabled:opacity-40"
                            title={canUsers ? 'Click to grant or revoke' : 'View only'}
                            disabled={!canUsers || (code === ROLES.SUPER_ADMIN && perm.key === 'users.manage') || (code === ROLES.VENDOR && (perm.key === 'users.manage' || perm.key === 'finance.reconcile'))}
                            onClick={() => role && togglePerm(role, perm.key)}
                          >
                            {hasPermission(granted, perm.key)
                              ? <Check className="w-5 h-5 mx-auto text-green-600" />
                              : <X className="w-5 h-5 mx-auto text-muted-foreground/40" />}
                          </button>
                        </TableCell>
                      );
                    })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Who these roles are for</p>
              <p><strong>Platform Admin</strong> — SaaS owner. Subscribers only. Not in this tenant table.</p>
              <p><strong>Merchant Super Admin</strong> — full access inside this tenant only.</p>
              <p><strong>Operations</strong> — orders, fulfilment, shipping, vendors.</p>
              <p><strong>Warehouse</strong> — inventory, picking, packing, dispatch.</p>
              <p><strong>Accounts</strong> — payments, reconciliation, finance.</p>
              <p><strong>Catalog Manager</strong> — products, SKUs, mappings.</p>
              <p><strong>Customer Support</strong> — orders, customers, returns.</p>
              <p><strong>Vendor</strong> — assigned vendor orders and dispatch only. Server must filter by assignedVendorIds.</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(roleEdit)}
        onOpenChange={(isOpen) => { if (!isOpen) setRoleEdit(null); }}
        title={roleEdit ? `Edit ${ROLE_LABELS[roleEdit.code] || roleEdit.name}` : 'Edit role'}
        description="These keys are what APIs check. Saving updates everyone with this role."
        footer={
          <>
            <Button variant="outline" onClick={() => setRoleEdit(null)}>Cancel</Button>
            <Button
              disabled={roleBusy}
              onClick={async () => {
                if (!roleEdit) return;
                setRoleBusy(true);
                const ok = await saveRolePermissions(roleEdit, rolePerms);
                setRoleBusy(false);
                if (ok) setRoleEdit(null);
              }}
            >
              {roleBusy ? 'Saving…' : 'Save permissions'}
            </Button>
          </>
        }
      >
        {roleEdit && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {PERMISSION_CATALOG.map((perm) => {
              const locked = roleEdit.code === ROLES.SUPER_ADMIN && perm.key === 'users.manage';
              const checked = rolePerms.includes(perm.key);
              return (
                <label key={perm.key} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={locked}
                    onChange={() => {
                      setRolePerms((prev) => (
                        prev.includes(perm.key)
                          ? prev.filter((key) => key !== perm.key)
                          : [...prev, perm.key]
                      ));
                    }}
                  />
                  <span>
                    <span className="font-medium">{perm.label}</span>
                    <code className="mt-0.5 block text-[11px] text-muted-foreground">{perm.key}</code>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        open={open}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) { setEditing(null); setInviteSecret(null); } }}
        title={inviteSecret ? 'Share login details' : editing ? 'Edit user' : 'Invite user'}
        footer={
          inviteSecret ? (
            <Button onClick={() => { setOpen(false); setInviteSecret(null); }}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={saveUser}>{editing ? 'Save' : 'Create user'}</Button>
            </>
          )
        }
      >
        {inviteSecret ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {inviteSecret.emailSent
                ? <>Password was emailed to <strong>{inviteSecret.email}</strong>. Keep a copy below as backup.</>
                : <>Copy this password and share it with <strong>{inviteSecret.email}</strong>.</>}
              {' '}They can later use Forgot password — OTP goes to Gmail.
            </p>
            {inviteSecret.temporaryPassword ? (
              <div className="flex items-center gap-2">
                <Input readOnly value={inviteSecret.temporaryPassword} className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteSecret.temporaryPassword);
                    toast.success('Password copied');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm">Account created. Ask them to use Forgot password on the login page.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {formBanner && <FormBanner tone="error" title="Could not save user">{formBanner}</FormBanner>}
            {!editing && (
              <p className="text-sm text-muted-foreground">
                Password is generated and sent to the user&apos;s Gmail. You will also see it once, as backup.
              </p>
            )}
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={formErrors.name} />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={formErrors.email} />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={form.role} error={formErrors.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {MATRIX_ROLES.map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
