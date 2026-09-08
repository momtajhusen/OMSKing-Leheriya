import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'react-hot-toast';
import { vendorProfile } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { VendorPage } from '../../components/vendor/VendorChrome';
import { Save, Send } from 'lucide-react';

const profileSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  contactPerson: z.string().min(1, 'Contact person is required'),
  phone: z.string().min(10, 'Phone must be at least 10 characters'),
  email: z.string().email('Invalid email format'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z.string().length(6, 'Pincode must be 6 digits'),
  gstin: z.string().length(15, 'GSTIN must be 15 characters'),
  bankAccount: z.string().min(9, 'Account number must be at least 9 digits'),
  ifsc: z.string().length(11, 'IFSC must be 11 characters'),
});

const NOTIFICATION_EVENTS = [
  { id: 'newOrder', label: 'New Order Assigned' },
  { id: 'orderCancelled', label: 'Order Cancelled' },
  { id: 'returnInitiated', label: 'Return Initiated' },
];

export default function VendorSettingsPage() {
  const [alerts, setAlerts] = useState({
    newOrder: true,
    orderCancelled: true,
    returnInitiated: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      businessName: vendorProfile.businessName,
      contactPerson: vendorProfile.contactPerson,
      phone: vendorProfile.phone,
      email: vendorProfile.email,
      address: vendorProfile.address,
      city: vendorProfile.city,
      state: vendorProfile.state,
      pincode: vendorProfile.pincode,
      gstin: vendorProfile.gstin,
      bankAccount: vendorProfile.bankAccount,
      ifsc: vendorProfile.ifsc,
    },
  });

  const onSubmit = (data) => {
    console.log('[Vendor] Save profile', data);
    toast.success('Profile saved');
  };

  const toggleAlert = (id) => {
    const next = !alerts[id];
    console.log('[Vendor] Toggle Telegram alert', { event: id, enabled: next });
    setAlerts((prev) => ({ ...prev, [id]: next }));
    toast.success(next ? 'Alert turned on' : 'Alert turned off');
  };

  return (
    <VendorPage title="Settings" subtitle="Your business details and where we send order alerts.">
      <Card className="premium-card border-0 shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Business Profile</CardTitle>
          <CardDescription>Leheriya uses these details for payouts and invoices.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Business Name</label>
                <Input {...register('businessName')} error={errors.businessName?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contact Person</label>
                <Input {...register('contactPerson')} error={errors.contactPerson?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <Input {...register('phone')} error={errors.phone?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input {...register('email')} error={errors.email?.message} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Full Address</label>
              <Input {...register('address')} error={errors.address?.message} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">City</label>
                <Input {...register('city')} error={errors.city?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">State</label>
                <Input {...register('state')} error={errors.state?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Pincode</label>
                <Input {...register('pincode')} error={errors.pincode?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">GSTIN</label>
                <Input {...register('gstin')} error={errors.gstin?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Bank Account Number</label>
                <Input {...register('bankAccount')} error={errors.bankAccount?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IFSC</label>
                <Input {...register('ifsc')} error={errors.ifsc?.message} />
              </div>
            </div>

            <Button type="submit">
              <Save className="h-4 w-4 mr-2" />
              Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="premium-card border-0 shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription>Your orders are posted to your own Telegram group.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[hsl(var(--color-border-premium))] p-3">
            <Send className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">{vendorProfile.telegramGroup}</div>
              <div className="text-sm text-muted-foreground">Telegram group for {vendorProfile.businessName}</div>
            </div>
            <Badge variant="outline">Connected</Badge>
          </div>

          <div className="space-y-2">
            {NOTIFICATION_EVENTS.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between rounded-lg border border-[hsl(var(--color-border-premium))] p-3"
              >
                <span className="text-sm font-medium">{event.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={alerts[event.id]}
                  aria-label={event.label}
                  onClick={() => toggleAlert(event.id)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    alerts[event.id] ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      alerts[event.id] ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </VendorPage>
  );
}
