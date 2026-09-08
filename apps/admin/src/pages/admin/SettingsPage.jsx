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
import { Building, Link, Truck, FileText, Key, Save, CheckCircle, XCircle } from 'lucide-react';

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
    { id: 'company', label: 'Company Details', icon: Building },
    { id: 'channels', label: 'Channel Connections', icon: Link },
    { id: 'couriers', label: 'Courier Settings', icon: Truck },
    { id: 'tax', label: 'Tax & GST', icon: FileText },
    { id: 'api', label: 'API Credentials', icon: Key },
  ];

  const channels = [
    { name: 'Shopify', status: 'Connected', lastSync: '2024-09-08 10:30 AM', failedJobs: 0 },
    { name: 'Amazon', status: 'Connected', lastSync: '2024-09-08 09:15 AM', failedJobs: 2 },
    { name: 'Myntra', status: 'Connected', lastSync: '2024-09-08 08:45 AM', failedJobs: 0 },
  ];

  const couriers = [
    { name: 'Delhivery', status: 'Active', priority: 1 },
    { name: 'Bluedart', status: 'Active', priority: 2 },
    { name: 'Ecom Express', status: 'Active', priority: 3 },
    { name: 'Xpressbees', status: 'Inactive', priority: 4 },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">Configure your OMSKing settings</p>
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

      {/* Tab Content */}
      {activeTab === 'company' && (
        <Card>
          <CardHeader>
            <CardTitle>Company Details</CardTitle>
            <CardDescription>Update your company information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Company Name</label>
                  <Input {...register('companyName')} error={errors.companyName?.message} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">GSTIN</label>
                  <Input {...register('gstin')} error={errors.gstin?.message} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">PAN</label>
                  <Input {...register('pan')} error={errors.pan?.message} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Support Email</label>
                  <Input {...register('supportEmail')} error={errors.supportEmail?.message} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Support Phone</label>
                  <Input {...register('supportPhone')} error={errors.supportPhone?.message} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Address</label>
                <Input {...register('address')} error={errors.address?.message} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">City</label>
                  <Input {...register('city')} error={errors.city?.message} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">District</label>
                  <Input {...register('district')} error={errors.district?.message} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Button type="submit">
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
                {saveStatus === 'success' && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Saved successfully</span>
                  </div>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === 'channels' && (
        <Card>
          <CardHeader>
            <CardTitle>Channel Connections</CardTitle>
            <CardDescription>Manage your marketplace integrations</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Failed Jobs</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.name}>
                    <TableCell className="font-medium">{channel.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{channel.status}</Badge>
                    </TableCell>
                    <TableCell>{channel.lastSync}</TableCell>
                    <TableCell>
                      {channel.failedJobs > 0 ? (
                        <Badge variant="destructive">{channel.failedJobs}</Badge>
                      ) : (
                        <Badge variant="outline">{channel.failedJobs}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">Sync Now</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'couriers' && (
        <Card>
          <CardHeader>
            <CardTitle>Courier Settings</CardTitle>
            <CardDescription>Configure shipping partners</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Courier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
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
                    <TableCell>
                      <Button variant="ghost" size="sm">Configure</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTab === 'tax' && (
        <Card>
          <CardHeader>
            <CardTitle>Tax & GST Settings</CardTitle>
            <CardDescription>Configure tax rates and GST settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Default GST Rate (%)</label>
                <Input defaultValue="12" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">HSN Code Master Upload</label>
                <Button variant="outline">Upload HSN Master File</Button>
              </div>
              <div className="pt-4 border-t">
                <h3 className="font-medium mb-2">Tax Rates by Category</h3>
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
          </CardContent>
        </Card>
      )}

      {activeTab === 'api' && (
        <Card>
          <CardHeader>
            <CardTitle>API Credentials</CardTitle>
            <CardDescription>Manage API keys and integrations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Shopify API Key</label>
                <Input type="password" defaultValue="sk_live_..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Amazon Marketplace ID</label>
                <Input defaultValue="A2Q3Y4..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Myntra Partner ID</label>
                <Input defaultValue="MNP123..." />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Webhook URL</label>
                <Input defaultValue="https://api.omsking.com/webhooks" />
              </div>
              <Button>
                <Save className="w-4 h-4 mr-2" />
                Save API Credentials
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}