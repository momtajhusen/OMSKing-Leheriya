import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendorOrders } from '../../mocks';
import { formatINR, formatDate } from '../../utils/format';
import { useAuth } from '../../hooks/useAuth';
import { VendorPage, VendorStat, VendorSheet } from '../../components/vendor/VendorChrome';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { Inbox, CheckCircle, PackageCheck, Truck, Check, X, IndianRupee } from 'lucide-react';

export default function VendorDashboardPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState(vendorOrders);

  const pending = rows.filter((r) => r.status === 'Pending Acceptance');
  const accepted = rows.filter((r) => r.status === 'Accepted');
  const readyToDispatch = rows.filter((r) => r.status === 'Ready to Dispatch');
  const dispatched = rows.filter((r) => r.dispatchedDate !== '');

  const assignedThisMonth = rows.filter((r) => r.status !== 'Rejected');
  const assignedValue = assignedThisMonth.reduce((sum, r) => sum + r.assignPrice, 0);

  const respond = (id, status) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    toast.success(status === 'Accepted' ? `Order ${id} accepted` : `Order ${id} rejected`);
  };

  return (
    <VendorPage
      title="Dashboard"
      subtitle={`Hello ${user?.name || 'vendor'}. Accept new lines, then ship from the sheet.`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <VendorStat label="To accept" value={pending.length} icon={Inbox} tone="amber" />
        <VendorStat label="In progress" value={accepted.length} icon={CheckCircle} tone="blue" />
        <VendorStat label="Ready to ship" value={readyToDispatch.length} icon={PackageCheck} tone="emerald" />
        <VendorStat label="Dispatched" value={dispatched.length} icon={Truck} tone="slate" />
        <VendorStat label="Assigned value" value={formatINR(assignedValue)} icon={IndianRupee} tone="rose" />
      </div>

      <div className="premium-card overflow-hidden p-0">
        <div className="border-b border-[hsl(var(--color-border-premium))] px-4 py-3">
          <h2 className="text-base font-semibold">Needs your Yes / No</h2>
          <p className="text-xs text-muted-foreground">Same Master Order the merchant assigned to you.</p>
        </div>
        <div className="p-4">
          {pending.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
              title="Nothing to accept"
              description="You have responded to every new order."
            />
          ) : (
            <VendorSheet>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 px-2">Order ID</TableHead>
                    <TableHead className="h-9 px-2">Product</TableHead>
                    <TableHead className="h-9 px-2">SKU</TableHead>
                    <TableHead className="h-9 px-2">Qty</TableHead>
                    <TableHead className="h-9 px-2">Assign Price</TableHead>
                    <TableHead className="h-9 px-2">Due Date</TableHead>
                    <TableHead className="h-9 px-2">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="p-2 font-medium">{row.orderId}</TableCell>
                      <TableCell className="p-2">{row.product}</TableCell>
                      <TableCell className="p-2 font-mono text-xs">{row.sku}</TableCell>
                      <TableCell className="p-2">{row.qty}</TableCell>
                      <TableCell className="p-2">{formatINR(row.assignPrice)}</TableCell>
                      <TableCell className="p-2">{formatDate(row.dueDate)}</TableCell>
                      <TableCell className="p-2">
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => respond(row.id, 'Accepted')}>
                            <Check className="h-4 w-4 mr-1" />
                            Accept
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => respond(row.id, 'Rejected')}>
                            <X className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        </div>
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
