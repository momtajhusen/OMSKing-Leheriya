import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Building, Link, Truck, FileText, Save, CheckCircle, Settings as SettingsIcon, Building2, Mail, Phone, MapPin, Globe, Warehouse } from 'lucide-react';
import ChannelSetup from '../../components/channels/ChannelSetup';

const companySchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  gstin: z.string().min(15, 'GSTIN must be 15 characters').max(15, 'GSTIN must be 15 characters'),
  pan: z.string().min(10, 'PAN must be 10 characters').max(10, 'PAN must be 10 characters'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  district: z.string().min(1, 'District is required'),
  supportEmail: z.string().email('Invalid email format'),
  supportPhone: z.string().min(10, 'Phone must be at least 10 characters'),
});

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('company');
  const [saveStatus, setSaveStatus] = useState(null);
  const [inventoryAuthority, setInventoryAuthority] = useState('oms');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(companySchema),
    defaultValues: {
      companyName: 'Leheriya Creations',
      gstin: '27AAPFU0939G1ZV',
      pan: 'AAPFU0939G',
      address: '123 Fashion Street',
      city: 'Jaipur',
      district: 'Rajasthan',
      supportEmail: 'support@leheriya.com',
      supportPhone: '+919876543210',
    },
  });

  const onSubmit = (data) => {
    setSaveStatus('success');
    toast.success('Settings saved successfully');
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const tabs = [
    { id: 'company', label: 'Company Details', icon: Building2 },
    { id: 'channels', label: 'Channel Connections', icon: Link },
    { id: 'couriers', label: 'Courier Settings', icon: Truck },
    { id: 'tax', label: 'Tax & GST', icon: FileText },
    { id: 'inventory', label: 'Inventory source', icon: Warehouse },
  ];

  const couriers = [
    { name: 'Delhivery', status: 'Active', priority: 1, rate: 85, pincode: 'All-India (excl. NE remote)' },
    { name: 'Bluedart', status: 'Active', priority: 2, rate: 120, pincode: 'Metro + tier 1' },
    { name: 'Ecom Express', status: 'Active', priority: 3, rate: 95, pincode: 'All-India' },
    { name: 'Xpressbees', status: 'Inactive', priority: 4, rate: 78, pincode: 'Paused' },
  ];

  return (
    <div className="p-6 space-y-8">
      {/* Modern Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] rounded-xl blur-lg opacity-30"></div>
            <div className="relative bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] rounded-xl p-3">
              <SettingsIcon className="h-6 w-6 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">Leheriya company, GST and pickup. Channel API keys live on Channels — not here for Admin.</p>
          </div>
        </div>
      </div>

      {/* Pill-style Tabs */}
      <div className="flex gap-2">
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
        <div className="premium-card p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">Company Details</h2>
              <p className="text-sm text-muted-foreground">Update your company information and business details.</p>
            </div>
            {saveStatus === 'success' && (
              <div className="flex items-center gap-2 text-green-500 bg-green-500/10 px-3 py-1.5 rounded-full">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">All changes saved</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            </div>

            <div className="pt-6 border-t border-[hsl(var(--color-border-premium))]">
              <button type="submit" className="premium-button">
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'channels' && (
        <div className="premium-card p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">Channel Connections</h2>
            <p className="text-sm text-muted-foreground">
              Choose a channel from the dropdown. API fields appear only for the channels you add.
            </p>
          </div>
          <ChannelSetup />
        </div>
      )}

      {activeTab === 'couriers' && (
        <div className="premium-card p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">Courier Settings</h2>
            <p className="text-sm text-muted-foreground">Configure shipping partners</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Rate (0.5kg)</TableHead>
                <TableHead>Serviceability</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((courier) => (
                <TableRow key={courier.name}>
                  <TableCell className="font-medium">{courier.name}</TableCell>
                  <TableCell>
                    <Badge variant={courier.status === 'Active' ? 'outline' : 'secondary'}>
                      {courier.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{courier.priority}</TableCell>
                  <TableCell>₹{courier.rate}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{courier.pincode}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">Configure</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === 'tax' && (
        <div className="premium-card p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-1">Tax & GST Settings</h2>
            <p className="text-sm text-muted-foreground">Configure tax rates and GST settings</p>
          </div>
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Default GST Rate (%)</label>
              <input defaultValue="12" className="premium-input" />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">HSN Code Master Upload</label>
              <Button variant="outline">Upload HSN Master File</Button>
            </div>
            <div className="pt-6 border-t border-[hsl(var(--color-border-premium))]">
              <h3 className="font-medium mb-4">Tax Rates by Category</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>GST Rate</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Clothing (Below ₹1000)</TableCell>
                    <TableCell>5%</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Clothing (Above ₹1000)</TableCell>
                    <TableCell>12%</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Premium Textiles</TableCell>
                    <TableCell>18%</TableCell>
                    <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inventory' && (
        <div className="premium-card p-8 space-y-4">
          <h2 className="text-xl font-semibold">Who owns sellable stock</h2>
          <p className="text-sm text-muted-foreground">
            Tenant config — not hard-coded to Leheriya. Amazon and Myntra still only receive WH-001.
          </p>
          {[
            { id: 'oms', title: 'OMS is master', text: 'Qty is edited here. Shopify, Amazon and Myntra receive the push.' },
            { id: 'shopify', title: 'Shopify is master', text: 'OMS does not allow sellable edits. Location A (WH-001) updates Shopify Offline, then Amazon and Myntra. OMS only fetches.' },
          ].map((opt) => (
            <label key={opt.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${inventoryAuthority === opt.id ? 'border-primary bg-primary/5' : 'border-[hsl(var(--color-border-premium))]'}`}>
              <input type="radio" name="inv-auth" className="mt-1" checked={inventoryAuthority === opt.id} onChange={() => setInventoryAuthority(opt.id)} />
              <span>
                <span className="block font-medium">{opt.title}</span>
                <span className="text-sm text-muted-foreground">{opt.text}</span>
              </span>
            </label>
          ))}
          <Button onClick={() => toast.success(inventoryAuthority === 'oms' ? 'OMS will push inventory' : 'Shopify Location A is the source for WH-001')}>
            Save inventory source
          </Button>
        </div>
      )}
    </div>
  );
}