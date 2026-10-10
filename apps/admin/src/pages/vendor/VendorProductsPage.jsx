import { useEffect, useMemo, useState } from 'react';
import useOrderStore from '../../stores/orderStore';
import { vendorLines } from '../../lib/vendorLines';
import { formatINR } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import { VendorPage, VendorSheet } from '../../components/vendor/VendorChrome';
import ProductThumb from '../../components/ui/ProductThumb';
import { Search, PackageSearch } from 'lucide-react';

export default function VendorProductsPage() {
  const orders = useOrderStore((s) => s.orders);
  const loaded = useOrderStore((s) => s.loaded);
  const hydrateFromApi = useOrderStore((s) => s.hydrateFromApi);
  const [search, setSearch] = useState('');

  useEffect(() => {
    hydrateFromApi();
  }, [hydrateFromApi]);

  const items = useMemo(() => {
    const bySku = new Map();
    vendorLines(orders).forEach((row) => {
      const current = bySku.get(row.sku) || {
        sku: row.sku,
        product: row.product,
        imageUrl: row.imageUrl || '',
        lines: 0,
        qty: 0,
        lastPrice: 0,
      };
      if (!current.imageUrl && row.imageUrl) current.imageUrl = row.imageUrl;
      current.lines += 1;
      current.qty += Number(row.qty) || 1;
      current.lastPrice = row.assignPrice || current.lastPrice;
      if (row.product) current.product = row.product;
      bySku.set(row.sku, current);
    });
    return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [orders]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? items.filter((row) => row.product.toLowerCase().includes(query) || row.sku.toLowerCase().includes(query))
    : items;

  if (!loaded) return <PageLoader label="Loading products..." />;

  return (
    <VendorPage
      title="My Products"
      subtitle="SKUs on lines assigned to you. Stock lives on the merchant inventory screen."
    >
      <div className="max-w-sm">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product or SKU"
          iconLeft={<Search className="h-4 w-4" />}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6 text-muted-foreground" />}
          title={items.length ? 'No products found' : 'No assigned SKUs'}
          description={items.length
            ? 'Nothing matches your search.'
            : 'When the merchant assigns an order line to you, that SKU will list here.'}
        />
      ) : (
        <VendorSheet>
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-2">Product</TableHead>
                <TableHead className="h-9 px-2">SKU</TableHead>
                <TableHead className="h-9 px-2">Assigned lines</TableHead>
                <TableHead className="h-9 px-2">Qty</TableHead>
                <TableHead className="h-9 px-2">Last assign price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow key={item.sku}>
                  <TableCell className="p-2 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <ProductThumb name={item.product || item.sku} sku={item.sku} src={item.imageUrl} />
                      {item.product || item.sku}
                    </div>
                  </TableCell>
                  <TableCell className="p-2 font-mono text-xs whitespace-nowrap">{item.sku}</TableCell>
                  <TableCell className="p-2">{item.lines}</TableCell>
                  <TableCell className="p-2">{item.qty}</TableCell>
                  <TableCell className="p-2 whitespace-nowrap">{formatINR(item.lastPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </VendorSheet>
      )}
    </VendorPage>
  );
}
