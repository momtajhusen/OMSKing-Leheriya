import { masterSkus } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Barcode, Plus, Search } from 'lucide-react';

export default function MasterSkuPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Master SKU</h1>
          <p className="text-muted-foreground">Manage internal SKU codes and variants</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Create Master SKU
        </Button>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by Master SKU or product name..."
              className="w-full pl-10 pr-4 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      {/* Master SKU Table */}
      <Card>
        <CardHeader>
          <CardTitle>Master SKU Catalog ({masterSkus.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Master SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Variant Attributes</TableHead>
                <TableHead>Base Product</TableHead>
                <TableHead>Channel Mappings</TableHead>
                <TableHead>Total Stock</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masterSkus.slice(0, 15).map((sku) => (
                <TableRow key={sku.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-muted-foreground" />
                      {sku.code}
                    </div>
                  </TableCell>
                  <TableCell>{sku.productName}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {Object.entries(sku.attributes).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="text-muted-foreground">{key}:</span> {value}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{sku.baseProduct}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{sku.channelMappings} channels</Badge>
                  </TableCell>
                  <TableCell>{sku.totalStock}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">View</Button>
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