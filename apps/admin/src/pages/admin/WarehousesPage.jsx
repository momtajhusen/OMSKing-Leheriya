import { useState } from 'react';
import { warehouses } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Building, MapPin, Plus, Box, Package } from 'lucide-react';

export default function WarehousesPage() {
  const [selectedWarehouses, setSelectedWarehouses] = useState(['WH-001']);

  const handleWarehouseToggle = (warehouseId) => {
    setSelectedWarehouses(prev =>
      prev.includes(warehouseId)
        ? prev.filter(id => id !== warehouseId)
        : [...prev, warehouseId]
    );
  };

  const handleAddAddress = () => {
    console.log('Adding new address for selected warehouses:', selectedWarehouses);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Warehouses</h1>
          <p className="text-muted-foreground">Manage warehouse locations and pickup addresses</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Warehouse
        </Button>
      </div>

      {/* Pickup Warehouse Selector */}
      <Card className="border-primary/50">
        <CardHeader>
          <CardTitle>Pickup Warehouse Selector</CardTitle>
          <CardDescription>
            Select warehouses for order pickup and courier integration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {warehouses.map(warehouse => (
                <label key={warehouse.id} className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedWarehouses.includes(warehouse.id)}
                    onChange={() => handleWarehouseToggle(warehouse.id)}
                    className="w-5 h-5"
                  />
                  <div>
                    <div className="font-medium">{warehouse.name}</div>
                    <div className="text-sm text-muted-foreground">{warehouse.location}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-4 pt-4 border-t">
              <Button onClick={handleAddAddress} disabled={selectedWarehouses.length === 0}>
                <Plus className="w-4 h-4 mr-2" />
                Add Address
              </Button>
              <span className="text-sm text-muted-foreground">
                {selectedWarehouses.length} warehouse(s) selected
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warehouse Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {warehouses.map(warehouse => (
          <Card key={warehouse.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="w-5 h-5" />
                    {warehouse.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {warehouse.location}
                    </div>
                  </CardDescription>
                </div>
                <Badge variant={warehouse.type === 'Physical' ? 'outline' : 'secondary'}>
                  {warehouse.type}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <Box className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Stock</p>
                      <p className="font-medium">{warehouse.stock}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Capacity</p>
                      <p className="font-medium">{warehouse.capacity}</p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Address</p>
                  <p className="text-sm">{warehouse.address}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">Edit</Button>
                  <Button variant="outline" size="sm">View Stock</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Warehouse Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Warehouse Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.map(warehouse => (
                <TableRow key={warehouse.id}>
                  <TableCell className="font-medium">{warehouse.id}</TableCell>
                  <TableCell>{warehouse.name}</TableCell>
                  <TableCell>
                    <Badge variant={warehouse.type === 'Physical' ? 'outline' : 'secondary'}>
                      {warehouse.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{warehouse.location}</TableCell>
                  <TableCell>{warehouse.stock}</TableCell>
                  <TableCell>{warehouse.capacity}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{warehouse.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">Manage</Button>
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