import { useState } from 'react';
import { orders } from '../../mocks';
import { formatINR, formatDate } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Truck, Package, Store, CheckCircle, ArrowRight } from 'lucide-react';

export default function FulfilmentPage() {
  const [activeTab, setActiveTab] = useState('available');

  // Mock data for the two lanes
  const directShipOrders = orders.filter(o => o.status === 'Processing').slice(0, 5);
  const vendorRoutedOrders = orders.filter(o => o.status === 'Awaiting_Shipment').slice(0, 5);

  const tabs = [
    { id: 'available', label: 'Stock Available → Pack & Ship', icon: Package },
    { id: 'unavailable', label: 'Stock Unavailable → Vendor Routing', icon: Store },
    { id: 'onhold', label: 'On Hold', icon: CheckCircle },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Fulfilment</h1>
        <p className="text-muted-foreground">Manage order fulfilment and vendor routing</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon className="w-4 h-4 mr-2" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Direct Ship Lane */}
      {activeTab === 'available' && (
        <div className="space-y-6">
          <Card className="border-green-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-green-600" />
                Direct Ship (Offline Stock)
              </CardTitle>
              <CardDescription>
                Orders with available stock in physical warehouses - ready for packing and shipping
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directShipOrders.map(order => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>{order.customerName}</TableCell>
                      <TableCell>{order.items.length}</TableCell>
                      <TableCell>{formatINR(order.totalValue)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">WH-001 Mumbai</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">{order.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          <Package className="w-4 h-4 mr-1" />
                          Pack & Ship
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Vendor Routed Lane */}
      {activeTab === 'unavailable' && (
        <div className="space-y-6">
          <Card className="border-blue-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="w-5 h-5 text-blue-600" />
                Routed to Vendor (Virtual Stock)
              </CardTitle>
              <CardDescription>
                Orders without physical stock - routed to vendor for fulfilment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Assigned Vendor</TableHead>
                    <TableHead>Assign Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorRoutedOrders.map(order => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.id}</TableCell>
                      <TableCell>{order.customerName}</TableCell>
                      <TableCell>{order.items.length}</TableCell>
                      <TableCell>{formatINR(order.totalValue)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">Sandeep Textiles</Badge>
                      </TableCell>
                      <TableCell>{formatINR(order.totalValue * 0.7)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{order.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm">
                          <ArrowRight className="w-4 h-4 mr-1" />
                          Route to Vendor
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* On Hold Lane */}
      {activeTab === 'onhold' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-yellow-600" />
              On Hold Orders
            </CardTitle>
            <CardDescription>
              Orders placed on hold pending resolution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No orders currently on hold</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Fulfilment Routing</p>
              <p className="text-sm text-muted-foreground">
                Orders with offline warehouse stock are packed and shipped directly. 
                Orders with only virtual stock are automatically routed to assigned vendors 
                with notification sent to Leheriya's number.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}