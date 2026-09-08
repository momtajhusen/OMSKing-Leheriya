import { useState } from 'react';
import { inventory, warehouses } from '../../mocks';
import { formatINR } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import { Warehouse, Package, AlertTriangle, TrendingUp } from 'lucide-react';

export default function InventoryPage() {
  const [activeWarehouse, setActiveWarehouse] = useState('all');

  const kpiData = {
    totalStock: inventory.reduce((sum, item) => sum + item.stock, 0),
    reserved: inventory.reduce((sum, item) => sum + item.reserved, 0),
    available: inventory.reduce((sum, item) => sum + item.available, 0),
    stockValue: inventory.reduce((sum, item) => sum + (item.stock * item.cost), 0),
  };

  const filteredInventory = activeWarehouse === 'all' 
    ? inventory 
    : inventory.filter(item => item.warehouse === activeWarehouse);

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Inventory</h1>
        <p className="text-muted-foreground">Manage stock across all warehouses</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Total Stock" value={kpiData.totalStock} icon={<Package className="w-4 h-4" />} />
        <KpiCard label="Reserved" value={kpiData.reserved} icon={<Package className="w-4 h-4" />} />
        <KpiCard label="Available" value={kpiData.available} icon={<Package className="w-4 h-4" />} />
        <KpiCard label="Stock Value" value={formatINR(kpiData.stockValue)} icon={<TrendingUp className="w-4 h-4" />} />
      </div>

      {/* Warehouse Tabs */}
      <div className="flex gap-2">
        <Button 
          variant={activeWarehouse === 'all' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setActiveWarehouse('all')}
        >
          All Warehouses
        </Button>
        {warehouses.map(wh => (
          <Button
            key={wh.id}
            variant={activeWarehouse === wh.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveWarehouse(wh.id)}
          >
            {wh.name}
          </Button>
        ))}
      </div>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <CardTitle>Stock Ledger ({filteredInventory.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.slice(0, 15).map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.sku}</TableCell>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.warehouse}</Badge>
                  </TableCell>
                  <TableCell>{item.stock}</TableCell>
                  <TableCell>{item.reserved}</TableCell>
                  <TableCell className="font-medium">{item.available}</TableCell>
                  <TableCell>{formatINR(item.cost)}</TableCell>
                  <TableCell>
                    {item.available < 10 ? (
                      <Badge variant="destructive">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Low Stock
                      </Badge>
                    ) : (
                      <Badge variant="outline">Normal</Badge>
                    )}
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