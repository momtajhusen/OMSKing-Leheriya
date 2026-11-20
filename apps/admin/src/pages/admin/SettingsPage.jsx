import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Building, Link, Truck, FileText, Save, CheckCircle, Settings as SettingsIcon, Building2, Mail, Phone, MapPin, Globe, Warehouse, ImagePlus, Trash2 } from 'lucide-react';
import ChannelSetup from '../../components/channels/ChannelSetup';
import CourierSettings from '../../components/settings/CourierSettings';
import TaxSettings from '../../components/settings/TaxSettings';
import ChannelWarehouseSettings from '../../components/settings/ChannelWarehouseSettings';
import api, { apiError } from '../../lib/api';
import { mediaUrl } from '../../components/account/ProfilePhoto';

const companySchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  legalName: z.string().trim(),
  brandName: z.string().trim(),
  gstin: z.string().min(15, 'GSTIN must be 15 characters').max(15, 'GSTIN must be 15 characters'),
  pan: z.string().min(10, 'PAN must be 10 characters').max(10, 'PAN must be 10 characters'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  district: z.string().min(1, 'District is required'),
  state: z.string().trim(),
  website: z.string().trim(),
  supportEmail: z.string().email('Invalid email format'),
  supportPhone: z.string().min(10, 'Phone must be at least 10 characters'),
  gmailUser: z.string().trim(),
  gmailAppPassword: z.string(),
}).superRefine((data, ctx) => {
  if (data.gmailUser && !z.string().email().safeParse(data.gmailUser).success) {
    ctx.addIssue({ code: 'custom', path: ['gmailUser'], message: 'Enter the company Gmail address' });
  }
  if (data.gmailAppPassword && !data.gmailUser) {
    ctx.addIssue({ code: 'custom', path: ['gmailUser'], message: 'Gmail address is required with the app password' });
  }
});

export default function SettingsPage() {
  const [params] = useSearchParams();
  const requestedTab = params.get('tab');
  const [activeTab, setActiveTab] = useState(
    ['company', 'channels', 'couriers', 'tax', 'inventory'].includes(requestedTab) ? requestedTab : 'company'
  );
  useEffect(() => {
    if (['company', 'channels', 'couriers', 'tax', 'inventory', 'links'].includes(requestedTab)) setActiveTab(requestedTab);
  }, [requestedTab]);
  const [saveStatus, setSaveStatus] = useState(null);
  const [inventoryAuthority, setInventoryAuthority] = useState('oms');
  const [authorityBusy, setAuthorityBusy] = useState(false);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(companySchema),
    defaultValues: {
      companyName: '',
      legalName: '',
      brandName: '',
      gstin: '',
      pan: '',
      address: '',
      city: '',
      district: '',
      state: '',
      website: '',
      supportEmail: '',
      supportPhone: '',
      gmailUser: '',
      gmailAppPassword: '',
    },
  });

  useEffect(() => {
    api.get('/warehouses/config').then(({ data }) => {
      if (data.data?.inventoryAuthority) setInventoryAuthority(data.data.inventoryAuthority);
    }).catch(() => {});
    api.get('/settings/company').then(({ data }) => {
      const company = data.data || {};
      reset({
        companyName: company.companyName || '',
        legalName: company.legalName || '',
        brandName: company.brandName || '',
        gstin: company.gstin || '',
        pan: company.pan || '',
        address: company.address || '',
        city: company.city || '',
        district: company.district || '',
        state: company.state || '',
        website: company.website || '',
        supportEmail: company.supportEmail || '',
        supportPhone: company.supportPhone || '',
        gmailUser: company.gmailUser || '',
        gmailAppPassword: '',
      });
      setMailConfigured(Boolean(company.mailConfigured));
      setLogoUrl(company.logoUrl || '');
    }).catch((err) => {
      toast.error(apiError(err, 'Could not load company details'));
    });
  }, [reset]);

  const onLogoFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    setLogoBusy(true);
    try {
      const { data } = await api.post('/settings/company/logo', body);
      setLogoUrl(data.data?.logoUrl || '');
      toast.success('Company logo saved — it will show on labels and invoices');
    } catch (err) {
      toast.error(apiError(err, 'Could not upload logo'));
    } finally {
      setLogoBusy(false);
    }
  };

  const clearLogo = async () => {
    setLogoBusy(true);
    try {
      const { data } = await api.delete('/settings/company/logo');
      setLogoUrl(data.data?.logoUrl || '');
      toast.success('Company logo removed');
    } catch (err) {
      toast.error(apiError(err, 'Could not remove logo'));
    } finally {
      setLogoBusy(false);
    }
  };

  const onSubmit = async (data) => {
    setCompanyBusy(true);
    try {
      await api.patch('/settings/company', data);
      if (data.gmailAppPassword) setMailConfigured(true);
      if (!data.gmailUser) setMailConfigured(false);
      setValue('gmailAppPassword', '');
      setSaveStatus('success');
      toast.success('Company details saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      toast.error(apiError(err, 'Could not save company details'));
    } finally {
      setCompanyBusy(false);
    }
  };

  const tabs = [
    { id: 'company', label: 'Company Details', icon: Building2 },
    { id: 'channels', label: 'Channel Connections', icon: Link },
    { id: 'couriers', label: 'Courier Settings', icon: Truck },
    { id: 'tax', label: 'Tax & GST', icon: FileText },
    { id: 'inventory', label: 'Inventory source', icon: Warehouse },
    { id: 'links', label: 'Channel & warehouse', icon: Link },
  ];

  return (
    <div className="space-y-4">
      {/* Modern Page Header */}
      <div className="flex min-w-0 items-start gap-3">
        <div className="relative shrink-0">
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] rounded-xl blur-lg opacity-30"></div>
          <div className="relative bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] rounded-xl p-3">
            <SettingsIcon className="h-6 w-6 text-white" />
          </div>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-muted-foreground">This company’s profile, Gmail, GST, and pickup. Channel and courier keys stay on this company only.</p>
        </div>
      </div>

      {/* Pill-style Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pill-tab ${activeTab === tab.id ? 'pill-tab-active' : 'pill-tab-inactive'}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'company' && (
        <div className="premium-card p-4">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">Company Details</h2>
              <p className="text-sm text-muted-foreground">
                These fields print on packing labels and tax invoices for this company only. Fill what your business needs — nothing is shared across tenants.
              </p>
            </div>
            {saveStatus === 'success' && (
              <div className="flex items-center gap-2 text-green-500 bg-green-500/10 px-3 py-1.5 rounded-full">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">All changes saved</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background">
                  {logoUrl ? (
                    <img src={mediaUrl(logoUrl)} alt="Company logo" className="max-h-full max-w-full object-contain p-2" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImagePlus className="h-6 w-6" />
                      <span className="text-xs">No logo</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block text-sm font-medium text-foreground">Company logo</label>
                  <p className="text-xs text-muted-foreground">
                    Shown on packing labels and invoices (top-left brand area). JPEG, PNG, or WebP · max 2MB.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={logoBusy} onClick={() => logoInputRef.current?.click()}>
                      <ImagePlus className="mr-1.5 h-4 w-4" />
                      {logoUrl ? 'Replace logo' : 'Upload logo'}
                    </Button>
                    {logoUrl ? (
                      <Button type="button" variant="ghost" size="sm" disabled={logoBusy} onClick={clearLogo}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={onLogoFile}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Company Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('companyName')}
                    className="premium-input pl-10"
                    placeholder="Enter company name"
                  />
                </div>
                {errors.companyName && (
                  <p className="text-sm text-destructive">{errors.companyName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Legal Name (invoice supplier)</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('legalName')}
                    className="premium-input pl-10"
                    placeholder="Registered company name for GST invoice"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Tax invoice seller name. Leave blank to use Company Name (e.g. Prdosco Global Private Limited).</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Brand name (labels)</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('brandName')}
                    className="premium-input pl-10"
                    placeholder="Shown on packing labels when no logo"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave blank to use company name. Each tenant sets their own — nothing is hard-coded.</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Website (invoice)</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('website')}
                    className="premium-input pl-10"
                    placeholder="www.yourstore.com"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Printed in the tax invoice header.</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">GSTIN</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('gstin')}
                    className="premium-input pl-10"
                    placeholder="Enter GSTIN"
                  />
                </div>
                {errors.gstin && (
                  <p className="text-sm text-destructive">{errors.gstin.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">PAN</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('pan')}
                    className="premium-input pl-10"
                    placeholder="Enter PAN"
                  />
                </div>
                {errors.pan && (
                  <p className="text-sm text-destructive">{errors.pan.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Support Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('supportEmail')}
                    className="premium-input pl-10"
                    placeholder="Enter support email"
                  />
                </div>
                {errors.supportEmail && (
                  <p className="text-sm text-destructive">{errors.supportEmail.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Support Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('supportPhone')}
                    className="premium-input pl-10"
                    placeholder="Enter support phone"
                  />
                </div>
                {errors.supportPhone && (
                  <p className="text-sm text-destructive">{errors.supportPhone.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Address</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  {...register('address')}
                  className="premium-input pl-10"
                  placeholder="Enter address"
                />
              </div>
              {errors.address && (
                <p className="text-sm text-destructive">{errors.address.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">City</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('city')}
                    className="premium-input pl-10"
                    placeholder="Enter city"
                  />
                </div>
                {errors.city && (
                  <p className="text-sm text-destructive">{errors.city.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">District</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('district')}
                    className="premium-input pl-10"
                    placeholder="Enter district"
                  />
                </div>
                {errors.district && (
                  <p className="text-sm text-destructive">{errors.district.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">State (invoice / GST)</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('state')}
                    className="premium-input pl-10"
                    placeholder="e.g. Delhi, Gujarat, Rajasthan"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Used when warehouse state is empty. Do not leave another tenant’s state here.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Company Gmail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    {...register('gmailUser')}
                    type="email"
                    autoComplete="off"
                    className="premium-input pl-10"
                    placeholder="mail@yourcompany.com"
                  />
                </div>
                {errors.gmailUser && (
                  <p className="text-sm text-destructive">{errors.gmailUser.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Gmail app password</label>
                <input
                  {...register('gmailAppPassword')}
                  type="password"
                  autoComplete="new-password"
                  className="premium-input"
                  placeholder={mailConfigured ? 'Saved. Leave blank to keep it.' : 'Google app password for this company'}
                />
                <p className="text-xs text-muted-foreground">OTP, invites, and notification email send from this mailbox. Another company cannot use it.</p>
              </div>
            </div>

            <div className="pt-6 border-t border-[hsl(var(--color-border-premium))]">
              <button type="submit" className="premium-button" disabled={companyBusy}>
                <Save className="w-4 h-4 mr-2" />
                {companyBusy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'channels' && (
        <div className="premium-card p-4">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">Channel Connections</h2>
            <p className="text-sm text-muted-foreground">
              Choose a channel from the dropdown. API fields appear only for the channels you add.
            </p>
          </div>
          <ChannelSetup />
        </div>
      )}

      {activeTab === 'links' && (
        <div className="premium-card p-4">
          <ChannelWarehouseSettings />
        </div>
      )}

      {activeTab === 'couriers' && (
        <div className="premium-card p-4">
          <CourierSettings />
        </div>
      )}

      {activeTab === 'tax' && (
        <div className="premium-card p-4">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">Tax & GST Settings</h2>
            <p className="text-sm text-muted-foreground">Default rate, category slabs, and the HSN master used on products</p>
          </div>
          <TaxSettings />
        </div>
      )}

      {activeTab === 'inventory' && (
        <div className="premium-card p-4 space-y-4">
          <h2 className="text-xl font-semibold">Who owns sellable stock</h2>
          <p className="text-sm text-muted-foreground">
            Tenant config — not hard-coded to Leheriya. Amazon and Myntra still only receive WH-001.
          </p>
          {[
            { id: 'oms', title: 'OMS is master', text: 'Qty is edited here. Amazon and Myntra receive the push. Shopify inventory is not overwritten.' },
            { id: 'shopify', title: 'Shopify is master', text: 'OMS does not allow sellable edits. Location A (WH-001) follows Shopify Offline, then Amazon and Myntra. OMS only fetches.' },
          ].map((opt) => (
            <label key={opt.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${inventoryAuthority === opt.id ? 'border-primary bg-primary/5' : 'border-[hsl(var(--color-border-premium))]'}`}>
              <input type="radio" name="inv-auth" className="mt-1" checked={inventoryAuthority === opt.id} onChange={() => setInventoryAuthority(opt.id)} />
              <span>
                <span className="block font-medium">{opt.title}</span>
                <span className="text-sm text-muted-foreground">{opt.text}</span>
              </span>
            </label>
          ))}
          <Button
            disabled={authorityBusy}
            onClick={async () => {
              setAuthorityBusy(true);
              try {
                await api.patch('/warehouses/config', { inventoryAuthority });
                toast.success(inventoryAuthority === 'oms' ? 'OMS is inventory master' : 'Shopify is inventory master — OMS stock edits blocked');
              } catch (err) {
                toast.error(apiError(err, 'Could not save inventory source'));
              } finally {
                setAuthorityBusy(false);
              }
            }}
          >
            Save inventory source
          </Button>
        </div>
      )}
    </div>
  );
}