import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import { formatINR } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Building2, Users, Ban, CreditCard, ArrowRight } from 'lucide-react';
import { VendorStat } from '../../components/vendor/VendorChrome';

export default function PlatformDashboardPage() {
  const navigate = useNavigate();
  const { impersonateTenant } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tenants')
      .then(({ data }) => setTenants(data.data || []))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const active = tenants.filter((t) => t.status === 'Active').length;
  const trial = tenants.filter((t) => t.status === 'Trial').length;
  const suspended = tenants.filter((t) => t.status === 'Suspended').length;
  const mrr = tenants.reduce((sum, t) => sum + (t.status === 'Suspended' ? 0 : t.mrr || 0), 0);

  if (loading) return <PageLoader label="Loading platform..." />;

  const openTenant = async (tenant) => {
    if (tenant.status === 'Suspended') {
      toast.error('Activate this tenant before opening it');
      navigate('/platform/tenants');
      return;
    }
    try {
      await impersonateTenant(tenant);
      toast.success(`Opened ${tenant.name}`);
      navigate('/dashboard');
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <PlatformPage
      title="SaaS control"
      subtitle="This login is not a merchant. It owns OMSKing and every subscriber tenant."
      action={<Button onClick={() => navigate('/platform/tenants')}>Manage subscribers</Button>}
    >
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-800 via-emerald-600 to-teal-600 p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <p className="text-sm font-medium text-white/80">Platform Admin</p>
        <p className="mt-1 max-w-xl text-lg font-semibold">Open a tenant as Super Admin — packing stays inside that merchant.</p>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-white/90 hover:text-white"
          onClick={() => navigate('/platform/health')}
        >
          Check adapters <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <VendorStat label="Active tenants" value={active} icon={Building2} tone="emerald" />
        <VendorStat label="Trials" value={trial} icon={Users} tone="blue" />
        <VendorStat label="Suspended" value={suspended} icon={Ban} tone="rose" />
        <VendorStat label="MRR" value={formatINR(mrr)} icon={CreditCard} tone="amber" />
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Subscribers</h2>
        <PlatformSheet>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Users</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <div className="font-medium">{tenant.name}</div>
                    <div className="text-xs text-muted-foreground">{tenant.slug}</div>
                  </TableCell>
                  <TableCell>{tenant.owner}</TableCell>
                  <TableCell>{tenant.plan}</TableCell>
                  <TableCell>
                    <Badge variant={tenant.status === 'Active' ? 'outline' : 'secondary'}>{tenant.status}</Badge>
                  </TableCell>
                  <TableCell>{tenant.users}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => openTenant(tenant)}>Open</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PlatformSheet>
      </div>
    </PlatformPage>
  );
}
