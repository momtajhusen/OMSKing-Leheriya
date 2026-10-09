import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import useVendorStore from '../../stores/vendorStore';
import { useAuth } from '../../hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import { VendorPage } from '../../components/vendor/VendorChrome';
import { ProfilePhotoButton, useProfilePhoto } from '../../components/account/ProfilePhoto';
import { Save, Send, Store } from 'lucide-react';

const profileSchema = z.object({
  name: z.string().min(1, 'Business name is required'),
  location: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email format').or(z.literal('')),
  telegramGroup: z.string().optional(),
});

export default function VendorSettingsPage() {
  const { user } = useAuth();
  const vendors = useVendorStore((s) => s.vendors);
  const loaded = useVendorStore((s) => s.loaded);
  const load = useVendorStore((s) => s.load);
  const upsertRow = useVendorStore((s) => s.upsertRow);
  const [busy, setBusy] = useState(false);
  const photo = useProfilePhoto();

  useEffect(() => {
    load();
  }, [load]);

  const vendor = vendors.find((row) => !row.removed) || null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', location: '', phone: '', email: '', telegramGroup: '' },
  });

  useEffect(() => {
    if (!vendor) return;
    reset({
      name: vendor.name || '',
      location: vendor.location || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      telegramGroup: vendor.telegramGroup || '',
    });
  }, [vendor, reset]);

  const onSubmit = async (data) => {
    setBusy(true);
    try {
      const { data: res } = await api.patch('/vendors/me', data);
      upsertRow(res.data);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(apiError(err, 'Could not save profile'));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <PageLoader label="Loading settings..." />;

  if (!vendor) {
    return (
      <VendorPage title="Settings" subtitle="Your business details for this merchant.">
        <EmptyState
          icon={<Store className="h-6 w-6 text-muted-foreground" />}
          title="No vendor profile linked"
          description="Ask the merchant to add your vendor on /vendors and attach this login. Until then this page stays empty."
        />
      </VendorPage>
    );
  }

  return (
    <VendorPage title="Settings" subtitle="Contact details the merchant uses when assigning orders.">
      <Card className="premium-card border-0 shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Business profile</CardTitle>
          <CardDescription>
            Signed in as {user?.name || user?.email}. Status {vendor.status}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="flex items-center gap-3">
              {photo.input}
              <ProfilePhotoButton name={user?.name || 'Vendor'} className="h-14 w-14" />
              <div>
                <p className="text-sm font-medium">Profile photo</p>
                <button type="button" className="text-sm text-emerald-700" onClick={photo.pick} disabled={photo.busy}>
                  {photo.busy ? 'Saving…' : 'Change photo'}
                </button>
                {photo.hasPhoto && (
                  <button type="button" className="ml-3 text-sm text-muted-foreground" onClick={photo.remove} disabled={photo.busy}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Business name</label>
                <Input {...register('name')} error={errors.name?.message} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Location</label>
                <Input {...register('location')} error={errors.location?.message} />
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
              <label className="block text-sm font-medium mb-1">Telegram group</label>
              <Input {...register('telegramGroup')} error={errors.telegramGroup?.message} placeholder="-1001234567890 or @vendor_group" />
            </div>
            <Button type="submit" disabled={busy}>
              <Save className="h-4 w-4 mr-2" />
              {busy ? 'Saving…' : 'Save profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="premium-card border-0 shadow-none">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Alerts</CardTitle>
          <CardDescription>When the merchant turns on Vendor Order Telegram, assign messages go to this group. The owner chat is a separate alert.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[hsl(var(--color-border-premium))] p-3">
            <Send className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">{vendor.telegramGroup || 'No Telegram group saved'}</div>
              <div className="text-sm text-muted-foreground">{vendor.name}</div>
            </div>
            <Badge variant="outline">{vendor.telegramGroup ? 'Saved' : 'Not set'}</Badge>
          </div>
        </CardContent>
      </Card>
    </VendorPage>
  );
}
