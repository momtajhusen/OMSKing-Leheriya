import { useState } from 'react';
import { users } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Users, Shield, Plus, Search, Check, X } from 'lucide-react';

export default function UsersRolesPage() {
  const [activeTab, setActiveTab] = useState('users');

  const tabs = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'roles', label: 'Roles & Permissions', icon: Shield },
  ];

  const roles = [
    { id: 'super_admin', name: 'Super Admin', permissions: 12, users: 1 },
    { id: 'admin', name: 'Admin', permissions: 8, users: 3 },
    { id: 'vendor', name: 'Vendor', permissions: 4, users: 5 },
  ];

  const permissions = [
    { module: 'Dashboard', super_admin: true, admin: true, vendor: true },
    { module: 'Orders', super_admin: true, admin: true, vendor: true },
    { module: 'Products', super_admin: true, admin: true, vendor: false },
    { module: 'Inventory', super_admin: true, admin: true, vendor: false },
    { module: 'Shipping', super_admin: true, admin: true, vendor: true },
    { module: 'Returns', super_admin: true, admin: true, vendor: true },
    { module: 'Reports', super_admin: true, admin: true, vendor: false },
    { module: 'Settings', super_admin: true, admin: false, vendor: false },
    { module: 'Users & Roles', super_admin: true, admin: false, vendor: false },
    { module: 'Tenant Mgmt', super_admin: true, admin: false, vendor: false },
    { module: 'Notifications', super_admin: true, admin: true, vendor: false },
    { module: 'Integrations', super_admin: true, admin: false, vendor: false },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Users & Roles</h1>
          <p className="text-muted-foreground">Manage user accounts and role-based access control</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
              activeTab === tab.id 
                ? 'border-primary text-primary' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle>User Management</CardTitle>
            <CardDescription>Manage system users and their roles</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search users..."
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map(user => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.status === 'Active' ? 'outline' : 'secondary'}>
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.lastLogin}</TableCell>
                    <TableCell>{user.createdAt}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <div className="space-y-6">
          {/* Roles Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Roles Summary</CardTitle>
              <CardDescription>Available roles and their user counts</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map(role => (
                    <TableRow key={role.id}>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell>{role.permissions} modules</TableCell>
                      <TableCell>{role.users} users</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">Configure</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Permission Matrix */}
          <Card>
            <CardHeader>
              <CardTitle>Permission Matrix</CardTitle>
              <CardDescription>Module access by role (based on Phase 0 RBAC blueprint)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead className="text-center">Super Admin</TableHead>
                    <TableHead className="text-center">Admin</TableHead>
                    <TableHead className="text-center">Vendor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permissions.map(perm => (
                    <TableRow key={perm.module}>
                      <TableCell className="font-medium">{perm.module}</TableCell>
                      <TableCell className="text-center">
                        {perm.super_admin ? (
                          <Check className="w-5 h-5 mx-auto text-green-600" />
                        ) : (
                          <X className="w-5 h-5 mx-auto text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {perm.admin ? (
                          <Check className="w-5 h-5 mx-auto text-green-600" />
                        ) : (
                          <X className="w-5 h-5 mx-auto text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {perm.vendor ? (
                          <Check className="w-5 h-5 mx-auto text-green-600" />
                        ) : (
                          <X className="w-5 h-5 mx-auto text-destructive" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Role Info */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Role Information</p>
                  <p className="text-sm text-muted-foreground">
                    <strong>Super Admin:</strong> Full system access including user management and tenant management.<br />
                    <strong>Admin:</strong> Operational access to orders, products, inventory, shipping, returns, and notifications.<br />
                    <strong>Vendor:</strong> Limited access to dashboard, orders, shipping, and returns for assigned orders only.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}