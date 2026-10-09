import { useEffect, useMemo } from 'react';
import useOrderStore from '../../stores/orderStore';
import { vendorLines } from '../../lib/vendorLines';
import { formatDate, formatINR } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import { VendorPage, VendorStat, VendorSheet } from '../../components/vendor/VendorChrome';
import ProductThumb from '../../components/ui/ProductThumb';
import { RotateCcw, Ban, Undo2 } from 'lucide-react';

const CANCELLED = ['Cancelled', 'Canceled', 'RTO'];

export default function VendorReturnsPage() {
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const items = useMemo(() => vendorLines(orders)
    .filter((row) => row.reversePickup || CANCELLED.includes(row.orderStatus))
    .map((row) => ({
      ...row,
      kind: row.reversePickup ? 'Customer return' : 'Cancelled',
      reason: row.reversePickup?.reason || '',
      eventDate: row.reversePickup?.bookedAt || row.reversePickup?.createdAt || row.assignedDate,
    })), [orders]);

  const returnsCount = items.filter((r) => r.kind === 'Customer return').length;

  if (!loaded) return <PageLoader label="Loading returns..." />;

  return (
    <VendorPage title="Returns" subtitle="Your lines that the customer returned or that were cancelled. Returned parcels go back to the merchant warehouse.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VendorStat label="Total" value={items.length} icon={RotateCcw} tone="blue" />
        <VendorStat label="Customer returns" value={returnsCount} icon={Undo2} tone="amber" />
        <VendorStat label="Cancelled" value={items.length - returnsCount} icon={Ban} tone="rose" />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-6 w-6 text-muted-foreground" />}
          title="No returns"
          description="None of your assigned lines were returned or cancelled."
        />
      ) : (
        <VendorSheet>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-2">Order ID</TableHead>
                <TableHead className="h-9 px-2">Product</TableHead>
                <TableHead className="h-9 px-2">SKU</TableHead>
                <TableHead className="h-9 px-2">Qty</TableHead>
                <TableHead className="h-9 px-2">Price</TableHead>
                <TableHead className="h-9 px-2">Type</TableHead>
                <TableHead className="h-9 px-2">Reason</TableHead>
                <TableHead className="h-9 px-2">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="p-2 font-medium whitespace-nowrap">{item.orderId}</TableCell>
                  <TableCell className="p-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <ProductThumb name={item.product || item.sku} src={item.imageUrl} />
                      {item.product}
                    </div>
                  </TableCell>
                  <TableCell className="p-2 font-mono text-xs whitespace-nowrap">{item.sku}</TableCell>
                  <TableCell className="p-2">{item.qty}</TableCell>
                  <TableCell className="p-2 whitespace-nowrap">{formatINR(item.assignPrice)}</TableCell>
                  <TableCell className="p-2"><Badge variant={item.kind === 'Cancelled' ? 'destructive' : 'secondary'}>{item.kind}</Badge></TableCell>
                  <TableCell className="p-2">{item.reason || '—'}</TableCell>
                  <TableCell className="p-2 whitespace-nowrap">{item.eventDate ? formatDate(item.eventDate) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </VendorSheet>
      )}
    </VendorPage>
  );
}
