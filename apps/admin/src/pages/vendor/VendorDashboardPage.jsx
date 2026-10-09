import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import useOrderStore from '../../stores/orderStore';
import { vendorLines } from '../../lib/vendorLines';
import { formatINR, formatDate } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { VendorPage, VendorStat, VendorSheet } from '../../components/vendor/VendorChrome';
import VendorProductThumb from '../../components/vendor/VendorProductThumb';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import { Inbox, CheckCircle, PackageCheck, Truck, Check, IndianRupee } from 'lucide-react';

export default function VendorDashboardPage() {
  const { user } = useAuth();
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const vendorUpdate = useOrderStore((s) => s.vendorUpdate);
  const rows = useMemo(() => vendorLines(orders), [orders]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const pending = rows.filter((r) => r.status === 'Pending Acceptance');
  const accepted = rows.filter((r) => r.status === 'Accepted');
  const ready = rows.filter((r) => r.status === 'Ready to Dispatch');
  const dispatched = rows.filter((r) => r.status === 'Dispatched' || r.status === 'Delivered');
  const assignedValue = rows.filter((r) => r.status !== 'Rejected').reduce((sum, r) => sum + r.assignPrice, 0);

  const accept = async (row) => {
    setBusy(row.id);
    const next = await vendorUpdate(row.masterId, row.id, { action: 'accept' });
    setBusy('');
    if (next?.error) toast.error(next.error);
    else toast.success(`${row.orderId} accepted`);
  };

  if (!loaded) return <PageLoader label="Loading dashboard..." />;

  return (
    <VendorPage
      title="Dashboard"
      subtitle={`Hello ${user?.name || 'vendor'}. Accept new lines, then ship from My Orders.`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <VendorStat label="To accept" value={pending.length} icon={Inbox} tone="amber" />
        <VendorStat label="In progress" value={accepted.length} icon={CheckCircle} tone="blue" />
        <VendorStat label="Ready to ship" value={ready.length} icon={PackageCheck} tone="emerald" />
        <VendorStat label="Dispatched" value={dispatched.length} icon={Truck} tone="slate" />
        <VendorStat label="Assigned value" value={formatINR(assignedValue)} icon={IndianRupee} tone="rose" />
      </div>

      <div className="premium-card overflow-hidden p-0">
        <div className="border-b border-[hsl(var(--color-border-premium))] px-4 py-3">
          <h2 className="text-base font-semibold">Needs your Yes / No</h2>
          <p className="text-xs text-muted-foreground">Reject with a reason on My Orders.</p>
        </div>
        <div className="p-4">
          {pending.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
              title="Nothing to accept"
              description={rows.length ? 'You have responded to every new line.' : 'No lines are assigned to you yet.'}
            />
          ) : (
            <VendorSheet>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 px-2">Order ID</TableHead>
                    <TableHead className="h-9 px-2">Product</TableHead>
                    <TableHead className="h-9 px-2">Photo</TableHead>
                    <TableHead className="h-9 px-2">SKU</TableHead>
                    <TableHead className="h-9 px-2">Qty</TableHead>
                    <TableHead className="h-9 px-2">Price</TableHead>
                    <TableHead className="h-9 px-2">Assigned</TableHead>
                    <TableHead className="h-9 px-2">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="p-2 font-medium">{row.orderId}</TableCell>
                      <TableCell className="p-2">{row.product}</TableCell>
                      <TableCell className="p-2"><VendorProductThumb name={row.product} src={row.imageUrl} /></TableCell>
                      <TableCell className="p-2 font-mono text-xs">{row.sku}</TableCell>
                      <TableCell className="p-2">{row.qty}</TableCell>
                      <TableCell className="p-2">{formatINR(row.assignPrice)}</TableCell>
                      <TableCell className="p-2">{row.assignedDate ? formatDate(row.assignedDate) : '—'}</TableCell>
                      <TableCell className="p-2">
                        <Button size="sm" disabled={busy === row.id} onClick={() => accept(row)}>
                          <Check className="h-4 w-4 mr-1" />
                          Accept
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </VendorSheet>
          )}
        </div>
      </div>
    </VendorPage>
  );
}
