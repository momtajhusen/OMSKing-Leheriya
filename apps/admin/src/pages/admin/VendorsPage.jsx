import { vendors } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import KpiCard from '../../components/ui/KpiCard';
import { Store, Plus, MessageCircle, Star, MapPin, Package } from 'lucide-react';

export default function VendorsPage() {
  const kpiData = {
    total: vendors.length,
    active: vendors.filter(v => v.status === 'Active').length,
    inactive: vendors.filter(v => v.status === 'Inactive').length,
    totalOrders: vendors.reduce((sum, v) => sum + v.assignedOrders, 0),
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Vendors</h1>
          <p className="text-muted-foreground">Manage vendor partnerships and assignments</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Vendor
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard label="Total Vendors" value={kpiData.total} icon={<Store className="w-4 h-4" />} />
        <KpiCard label="Active" value={kpiData.active} icon={<Store className="w-4 h-4" />} />
        <KpiCard label="Inactive" value={kpiData.inactive} icon={<Store className="w-4 h-4" />} />
        <KpiCard label="Total Orders" value={kpiData.totalOrders} icon={<Package className="w-4 h-4" />} />
      </div>

      {/* Vendor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {vendors.slice(0, 6).map(vendor => (
          <Card key={vendor.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    {vendor.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {vendor.location}
                    </div>
                  </CardDescription>
                </div>
                <Badge variant={vendor.status === 'Active' ? 'outline' : 'secondary'}>
                  {vendor.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Assigned Orders</p>
                    <p className="text-xl font-bold">{vendor.assignedOrders}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Rating</p>
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      <span className="text-xl font-bold">{vendor.rating}</span>
                    </div>
                  </div>
                </div>
                {vendor.telegramGroup && (
                  <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg">
                    <MessageCircle className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Telegram Group</span>
                    <Badge variant="outline" className="ml-auto">Active</Badge>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1">View Orders</Button>
                  <Button variant="outline" size="sm">Edit</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Vendor Table */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Assigned Orders</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Telegram Group</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map(vendor => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>{vendor.location}</TableCell>
                  <TableCell>{vendor.assignedOrders}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      <span>{vendor.rating}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={vendor.status === 'Active' ? 'outline' : 'secondary'}>
                      {vendor.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {vendor.telegramGroup ? (
                      <Badge variant="outline" className="gap-1">
                        <MessageCircle className="w-3 h-3" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not Connected</Badge>
                    )}
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