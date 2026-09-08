import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { vendorProducts } from '../../mocks';
import { formatINR } from '../../utils/format';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import { VendorPage, VendorSheet } from '../../components/vendor/VendorChrome';
import { Search, Save, PackageSearch } from 'lucide-react';

const ORIGINAL_STOCK = new Map(vendorProducts.map((p) => [p.id, p.stockAvailable]));

export default function VendorProductsPage() {
  const [items, setItems] = useState(vendorProducts);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const visibleItems = query
    ? items.filter(
        (p) => p.product.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)
      )
    : items;

  const changedItems = items.filter((p) => ORIGINAL_STOCK.get(p.id) !== p.stockAvailable);

  const updateStock = (id, value) => {
    const stock = value === '' ? '' : Number(value);
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, stockAvailable: stock } : p)));
  };

  const saveStock = () => {
    console.log('[Vendor] Save stock availability', changedItems);
    toast.success(`Stock updated for ${changedItems.length} ${changedItems.length === 1 ? 'product' : 'products'}`);
  };

  return (
    <VendorPage
      title="My Products"
      subtitle="The items you supply. Update how many pieces you can send right now."
      action={
        <Button onClick={saveStock} disabled={changedItems.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          Save Stock{changedItems.length > 0 ? ` (${changedItems.length})` : ''}
        </Button>
      }
    >
      <div className="max-w-sm">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product or SKU"
          iconLeft={<Search className="h-4 w-4" />}
        />
      </div>

      {visibleItems.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="h-6 w-6 text-muted-foreground" />}
          title="No products found"
          description="Nothing matches your search. Try a different product name or SKU."
        />
      ) : (
        <VendorSheet>
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 px-2">Product</TableHead>
              <TableHead className="h-9 px-2">SKU</TableHead>
              <TableHead className="h-9 px-2">Size</TableHead>
              <TableHead className="h-9 px-2">Color</TableHead>
              <TableHead className="h-9 px-2">Your Price</TableHead>
              <TableHead className="h-9 px-2">Lead Time (days)</TableHead>
              <TableHead className="h-9 px-2 w-44">Stock You Can Supply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="p-2 font-medium whitespace-nowrap">{item.product}</TableCell>
                <TableCell className="p-2 font-mono text-xs whitespace-nowrap">{item.sku}</TableCell>
                <TableCell className="p-2 whitespace-nowrap">{item.size}</TableCell>
                <TableCell className="p-2">{item.color}</TableCell>
                <TableCell className="p-2 whitespace-nowrap">{formatINR(item.yourPrice)}</TableCell>
                <TableCell className="p-2">{item.leadTimeDays}</TableCell>
                <TableCell className="p-1">
                  <Input
                    className="h-9"
                    type="number"
                    min="0"
                    value={item.stockAvailable}
                    onChange={(e) => updateStock(item.id, e.target.value)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </VendorSheet>
      )}
    </VendorPage>
  );
}
