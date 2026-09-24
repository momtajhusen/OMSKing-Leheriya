import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { CHANNEL_CATALOG, SUBSCRIPTION_PLANS } from '../../mocks';
import api, { apiError, apiFormError } from '../../lib/api';
import { emailSchema } from '../../lib/validation';
import { FormBanner } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
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
  const [tenants, setTenants] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [merchantName, setMerchantName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [planId, setPlanId] = useState('growth');
  const [picked, setPicked] = useState([]);
  const [planTenant, setPlanTenant] = useState(null);
  const [nextPlan, setNextPlan] = useState('growth');
  const [loading, setLoading] = useState(true);
  const [wizardBanner, setWizardBanner] = useState('');
  const [wizardErrors, setWizardErrors] = useState({});

  const loadTenants = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tenants');
      setTenants(data.data || []);
    } catch (err) {
      toast.error(apiError(err, 'Could not load tenants'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTenants(); }, []);

  const startWizard = () => {
    setShowWizard(true);
    setWizardStep(1);
    setMerchantName('');
    setOwnerEmail('');
    setPlanId('growth');
    setPicked([]);
    setWizardBanner('');
    setWizardErrors({});
  };

  const completeWizard = async () => {
    const names = CHANNEL_CATALOG.filter((c) => picked.includes(c.id)).map((c) => c.name);
    try {
      await api.post('/tenants', {
        name: merchantName,
        email: ownerEmail,
        plan: planId,
        channels: names,
      });
      toast.success(`${merchantName} onboarded. Invite sent to ${ownerEmail}`);
      setShowWizard(false);
      await loadTenants();
    } catch (err) {
      const parsed = apiFormError(err);
      setWizardErrors({
        merchantName: parsed.fields.name,
        ownerEmail: parsed.fields.email,
      });
      setWizardBanner(parsed.message === 'Validation failed' ? 'Please fix the highlighted fields.' : parsed.message);
      setWizardStep(1);
    }
  };

  const setStatus = async (tenant, status) => {
    try {
      await api.patch(`/tenants/${tenant.id}`, { status });
      toast.success(`${tenant.name} marked ${status}`);
      loadTenants();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const openMerchant = async (tenant) => {
    if (tenant.status === 'Suspended') {
      toast.error('Activate this tenant before opening it');
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

  const savePlan = async () => {
    if (!planTenant) return;
    try {
      await api.patch(`/tenants/${planTenant.id}`, { plan: nextPlan });
      toast.success(`${planTenant.name} plan updated`);
      setPlanTenant(null);
      loadTenants();
    } catch (err) {
      toast.error(apiError(err));
    }
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
            <Card key={plan.id} className={`premium-card border-0 ${plan.id === 'enterprise' ? 'ring-2 ring-emerald-500/30' : ''}`}>
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
        <Card className="premium-card border-0 ring-2 ring-emerald-500/25">
          <CardHeader>
            <CardTitle>New tenant</CardTitle>
            <CardDescription>Step {wizardStep} of 4 — merchant, channels, Super Admin, then bulk catalog import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {wizardBanner && <FormBanner tone="error" title="Cannot continue">{wizardBanner}</FormBanner>}
            {wizardStep === 1 && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Merchant name</label>
                  <Input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="e.g. Leheriya Creations" error={wizardErrors.merchantName} />
                </div>
                <div>
                  <label className="text-sm font-medium">Owner email</label>
                  <Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@merchant.com" error={wizardErrors.ownerEmail} />
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
                {wizardErrors.channels && <p className="mb-2 text-xs font-medium text-destructive">{wizardErrors.channels}</p>}
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
                  setWizardBanner('');
                  if (wizardStep === 1) {
                    const next = {};
                    if (merchantName.trim().length < 2) next.merchantName = 'Merchant name must be at least 2 characters';
                    const emailCheck = emailSchema.safeParse(ownerEmail);
                    if (!emailCheck.success) next.ownerEmail = emailCheck.error.issues[0]?.message || 'Enter a valid email';
                    setWizardErrors(next);
                    if (Object.keys(next).length) {
                      setWizardBanner('Please fix the highlighted fields.');
                      return;
                    }
                  }
                  if (wizardStep === 2 && picked.length === 0) {
                    setWizardErrors({ channels: 'Select at least one channel' });
                    setWizardBanner('Select at least one launch channel.');
                    return;
                  }
                  setWizardErrors({});
                  if (wizardStep < 4) setWizardStep(wizardStep + 1);
                  else completeWizard();
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
          <div className="premium-card bg-emerald-50/80 p-4 dark:bg-emerald-950/30">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 text-emerald-600" />
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
