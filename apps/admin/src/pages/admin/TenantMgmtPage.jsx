import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { CHANNEL_CATALOG, SUBSCRIPTION_PLANS } from '../../mocks';
import { PLATFORM_TENANTS } from '../../mocks/platform';
import { useAuth } from '../../hooks/useAuth';
import { useSimulatedLoad } from '../../hooks/useSimulatedLoad';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import PageLoader from '../../components/ui/PageLoader';
import Modal from '../../components/ui/Modal';
import { Building2, Plus, CheckCircle } from 'lucide-react';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';

export default function TenantMgmtPage() {
  const navigate = useNavigate();
  const { impersonateTenant } = useAuth();
  const [tab, setTab] = useState('tenants');
  const [tenants, setTenants] = useState(PLATFORM_TENANTS);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [merchantName, setMerchantName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [planId, setPlanId] = useState('growth');
  const [picked, setPicked] = useState([]);
  const [planTenant, setPlanTenant] = useState(null);
  const [nextPlan, setNextPlan] = useState('growth');
  const loading = useSimulatedLoad(tab);

  const startWizard = () => {
    setShowWizard(true);
    setWizardStep(1);
    setMerchantName('');
    setOwnerEmail('');
    setPlanId('growth');
    setPicked([]);
  };

  const completeWizard = () => {
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
    const names = CHANNEL_CATALOG.filter((c) => picked.includes(c.id)).map((c) => c.name);
    const id = `TNT-${String(tenants.length + 1).padStart(3, '0')}`;
    setTenants((prev) => [
      {
        id,
        name: merchantName,
        owner: ownerEmail.split('@')[0],
        email: ownerEmail,
        status: 'Trial',
        plan: plan?.name || 'Growth',
        channels: names,
        users: 1,
        lastSync: 'Never',
        mrr: 0,
      },
      ...prev,
    ]);
    toast.success(`${merchantName} onboarded. Invite sent to ${ownerEmail}`);
    setShowWizard(false);
  };

  const setStatus = (tenant, status) => {
    setTenants((prev) => prev.map((item) => (item.id === tenant.id ? { ...item, status } : item)));
    toast.success(`${tenant.name} marked ${status}`);
  };

  const openMerchant = (tenant) => {
    if (tenant.status === 'Suspended') {
      toast.error('Activate this tenant before opening it');
      return;
    }
    impersonateTenant(tenant);
    toast.success(`Opened ${tenant.name}`);
    navigate('/dashboard');
  };

  const savePlan = () => {
    if (!planTenant) return;
    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === nextPlan);
    setTenants((prev) => prev.map((item) => (item.id === planTenant.id ? { ...item, plan: plan?.name || item.plan } : item)));
    toast.success(`${planTenant.name} moved to ${plan?.name}`);
    setPlanTenant(null);
  };

  if (loading) return <PageLoader label="Loading subscribers..." />;

  return (
    <PlatformPage
      title="Subscribers"
      subtitle="Each row is a merchant tenant — own users, channels, and data. Not a vendor packing list."
      action={
        <Button onClick={startWizard}>
          <Plus className="w-4 h-4 mr-2" />
          New Tenant
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tab === 'tenants' ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'} onClick={() => setTab('tenants')}>
          Tenants
        </button>
        <button type="button" className={tab === 'plans' ? 'pill-tab pill-tab-active' : 'pill-tab pill-tab-inactive'} onClick={() => setTab('plans')}>
          Plans & Subscriptions
        </button>
      </div>

      {tab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <Card key={plan.id} className={`premium-card border-0 ${plan.id === 'enterprise' ? 'ring-2 ring-indigo-500/30' : ''}`}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.price}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm mb-3">
                  {plan.channelLimit == null ? 'Unlimited channels' : `${plan.channelLimit} channel(s)`}
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {plan.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'tenants' && showWizard && (
        <Card className="premium-card border-0 ring-2 ring-indigo-500/25">
          <CardHeader>
            <CardTitle>New tenant</CardTitle>
            <CardDescription>Step {wizardStep} of 4 — merchant, channels, Super Admin, then bulk catalog import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {wizardStep === 1 && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Merchant name</label>
                  <Input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="e.g. Leheriya Creations" />
                </div>
                <div>
                  <label className="text-sm font-medium">Owner email</label>
                  <Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@merchant.com" />
                </div>
                <div>
                  <label className="text-sm font-medium">Subscription plan</label>
                  <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    {SUBSCRIPTION_PLANS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.price}</option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
            {wizardStep === 2 && (
              <div>
                <p className="text-sm text-muted-foreground mb-3">Select launch channels. Merchant Super Admin can add more later.</p>
                <div className="max-w-sm mb-3">
                  <Select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id && !picked.includes(id)) setPicked((prev) => [...prev, id]);
                    }}
                  >
                    <option value="">Select channel</option>
                    {CHANNEL_CATALOG.filter((c) => !picked.includes(c.id)).map((channel) => (
                      <option key={channel.id} value={channel.id}>{channel.name}</option>
                    ))}
                  </Select>
                </div>
                {picked.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {picked.map((id) => (
                      <Badge key={id} variant="outline" className="gap-1">
                        {CHANNEL_CATALOG.find((c) => c.id === id)?.name}
                        <button type="button" className="ml-1" onClick={() => setPicked((prev) => prev.filter((x) => x !== id))}>×</button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            {wizardStep === 3 && (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                <CheckCircle className="w-4 h-4" />
                Default roles (Super Admin, Admin, Vendor), warehouses and notification seeds will be cloned for this tenant.
              </div>
            )}
            {wizardStep === 4 && (
              <p className="text-sm text-muted-foreground">
                After create, import products Shopify → Myntra → Amazon. Same SKU auto-maps. Remainder sits in Unmapped Listings.
              </p>
            )}
            <div className="flex justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => (wizardStep === 1 ? setShowWizard(false) : setWizardStep(wizardStep - 1))}>
                {wizardStep === 1 ? 'Cancel' : 'Previous'}
              </Button>
              <Button
                onClick={() => {
                  if (wizardStep === 1 && (!merchantName.trim() || !ownerEmail.includes('@'))) {
                    toast.error('Enter merchant name and owner email');
                    return;
                  }
                  if (wizardStep === 2 && picked.length === 0) {
                    toast.error('Select at least one channel');
                    return;
                  }
                  if (wizardStep < 4) setWizardStep(wizardStep + 1);
                  else {
                    completeWizard();
                    toast.success('Tenant created. Open merchant, then Catalog → Bulk import (Shopify → Myntra → Amazon).');
                  }
                }}
              >
                {wizardStep === 4 ? 'Create & open import' : 'Next'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'tenants' && (
        <>
          <div className="premium-card bg-indigo-50/80 p-4 dark:bg-indigo-950/30">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 text-indigo-600" />
              <div>
                <p className="font-medium">SaaS isolation</p>
                <p className="text-sm text-muted-foreground">
                  Open merchant puts you inside that tenant as Super Admin (impersonation). Tenant data stays filtered by tenantId. Vendor users never see this screen.
                </p>
              </div>
            </div>
          </div>

          <PlatformSheet>
            <div className="border-b border-[hsl(var(--color-border-premium))] px-4 py-3">
              <h2 className="font-semibold">Tenant list ({tenants.length})</h2>
            </div>
            <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Channels</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell>
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground">{tenant.id}</div>
                      </TableCell>
                      <TableCell>
                        <div>{tenant.owner}</div>
                        <div className="text-xs text-muted-foreground">{tenant.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tenant.status === 'Active' ? 'outline' : 'secondary'}>{tenant.status}</Badge>
                      </TableCell>
                      <TableCell>{tenant.plan}</TableCell>
                      <TableCell className="text-sm">{tenant.channels.length ? tenant.channels.join(', ') : '—'}</TableCell>
                      <TableCell>{tenant.users}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openMerchant(tenant)}>Open</Button>
                          <Button variant="ghost" size="sm" onClick={() => { setPlanTenant(tenant); setNextPlan('growth'); }}>Plan</Button>
                          {tenant.status === 'Suspended' ? (
                            <Button variant="ghost" size="sm" onClick={() => setStatus(tenant, 'Active')}>Activate</Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setStatus(tenant, 'Suspended')}>Suspend</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </PlatformSheet>
        </>
      )}

      <Modal
        open={!!planTenant}
        onOpenChange={(open) => !open && setPlanTenant(null)}
        title="Change plan"
        description={planTenant ? planTenant.name : ''}
        footer={
          <>
            <Button variant="outline" onClick={() => setPlanTenant(null)}>Cancel</Button>
            <Button onClick={savePlan}>Save plan</Button>
          </>
        }
      >
        <Select value={nextPlan} onChange={(e) => setNextPlan(e.target.value)}>
          {SUBSCRIPTION_PLANS.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {p.price}</option>
          ))}
        </Select>
      </Modal>
    </PlatformPage>
  );
}
