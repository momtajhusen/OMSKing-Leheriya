import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { users as userSeed } from '../../mocks';
import { useAuth } from '../../hooks/useAuth';
import { ROLES, ROLE_LABELS, MERCHANT_ASSIGNABLE_ROLES } from '../../constants/roles';
import { PERMISSION_CATALOG, ROLE_PERMISSIONS, hasPermission } from '../../constants/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { Users, Shield, Plus, Search, Check, X } from 'lucide-react';

const emptyUser = { name: '', email: '', role: ROLES.OPERATIONS };
const MATRIX_ROLES = MERCHANT_ASSIGNABLE_ROLES.filter((role) => role !== ROLES.ADMIN);

export default function UsersRolesPage() {
  const { user: currentUser } = useAuth();
  const { canUsers } = usePermissions();
  const [activeTab, setActiveTab] = useState('users');
  const [userList, setUserList] = useState(userSeed.map((u) => ({ ...u, tenant: currentUser?.tenantName || 'Leheriya Creations' })));
  const [searchQuery, setSearchQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyUser);
  const loading = useSimulatedLoad(activeTab);

  const filtered = useMemo(() => userList.filter((item) => {
    const q = searchQuery.toLowerCase();
    const label = ROLE_LABELS[item.role] || item.role;
    return !q || item.name.toLowerCase().includes(q) || item.email.toLowerCase().includes(q) || label.toLowerCase().includes(q);
  }), [userList, searchQuery]);

  const saveUser = () => {
    if (!form.name.trim() || !form.email.includes('@')) {
      toast.error('Name and email are required');
      return;
    }
    if (editing) {
      setUserList((prev) => prev.map((item) => (item.id === editing.id ? { ...item, ...form } : item)));
      toast.success(`${form.name} updated`);
    } else {
      setUserList((prev) => [
        {
          id: `USR-${String(prev.length + 1).padStart(3, '0')}`,
          ...form,
          status: 'Active',
          lastLogin: 'Never',
          createdAt: '2026-09-08',
          tenant: currentUser?.tenantName,
        },
        ...prev,
      ]);
      toast.success(`Invite sent to ${form.email}`);
    }
    setOpen(false);
    setEditing(null);
  };

  const toggleStatus = (row) => {
    const next = row.status === 'Active' ? 'Inactive' : 'Active';
    setUserList((prev) => prev.map((item) => (item.id === row.id ? { ...item, status: next } : item)));
    toast.success(`${row.name} marked ${next}`);
  };

  if (loading) return <PageLoader label="Loading users & roles..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Users & Roles</h1>
          <p className="text-muted-foreground">
            Permissions are checked as keys (orders.view, finance.reconcile, …) — not by role title alone. This tenant cannot see another merchant. Platform Admin is not assigned here.
          </p>
        </div>
        {canUsers && (
          <Button onClick={() => { setEditing(null); setForm(emptyUser); setOpen(true); }}>
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
                  {filtered.map((row) => (
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
                            <Button variant="ghost" size="sm" onClick={() => { setEditing(row); setForm({ name: row.name, email: row.email, role: row.role }); setOpen(true); }}>Edit</Button>
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
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'roles' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Permission matrix</CardTitle>
              <CardDescription>APIs must call requirePermission(key). Role names never grant access by themselves.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Permission</TableHead>
                    {MATRIX_ROLES.map((role) => (
                      <TableHead key={role} className="text-center whitespace-nowrap text-xs">{ROLE_LABELS[role]}</TableHead>
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
                      {MATRIX_ROLES.map((role) => (
                        <TableCell key={role} className="text-center">
                          {hasPermission(ROLE_PERMISSIONS[role], perm.key)
                            ? <Check className="w-5 h-5 mx-auto text-green-600" />
                            : <X className="w-5 h-5 mx-auto text-muted-foreground/40" />}
                        </TableCell>
                      ))}
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
        open={open}
        onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setEditing(null); }}
        title={editing ? 'Edit user' : 'Invite user'}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={saveUser}>{editing ? 'Save' : 'Send invite'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {MATRIX_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
