import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { products } from '../../mocks';
import { formatINR, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import { Package, Plus, Search, Filter } from 'lucide-react';

export default function ProductsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = products.filter(product => {
    return searchQuery === '' || 
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const kpiData = {
    total: products.length,
    active: products.filter(p => p.status === 'Active').length,
    inactive: products.filter(p => p.status === 'Inactive').length,
    lowStock: products.filter(p => p.stock < 10).length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Products</h1>
          <p className="text-muted-foreground">Leheriya catalog. Variants hang off Master SKU — not a one-off Amazon title.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/import')}>
            Bulk import
          </Button>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Products" value={kpiData.total} icon={Package} />
        <KpiCard label="Active" value={kpiData.active} icon={Package} />
        <KpiCard label="Inactive" value={kpiData.inactive} icon={Package} />
        <KpiCard label="Low Stock" value={kpiData.lowStock} icon={Package} />
      </div>

      {/* Search and Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by product name or SKU..."
                className="w-full pl-10 pr-4 py-2 border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary-blue))]/20 focus:border-[hsl(var(--color-primary-blue))] transition-all"
                style={{
                  backgroundColor: 'hsl(var(--color-card-bg))',
                  color: 'hsl(var(--color-foreground))'
                }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline">
              <Filter className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader>
          <CardTitle>Product Catalog ({filteredProducts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead>GST %</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.slice(0, 15).map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded-md flex items-center justify-center">
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">{product.category}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{product.sku}</TableCell>
                  <TableCell>{product.hsn}</TableCell>
                  <TableCell>{product.gst}%</TableCell>
                  <TableCell>{formatINR(product.price)}</TableCell>
                  <TableCell>
                    <span className={product.stock < 10 ? 'text-destructive font-medium' : ''}>
                      {product.stock}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(product.status)}>
                      {product.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}