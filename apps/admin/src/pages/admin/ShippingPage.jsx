import { useState } from 'react';
import { orders, shipments } from '../../mocks';
import { formatINR, formatDate } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Truck, Package, Download, RefreshCw, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

export default function ShippingPage() {
  const [selectedOrder, setSelectedOrder] = useState(orders[0]);
  const [showRateComparison, setShowRateComparison] = useState(false);

  const courierOptions = [
    {
      id: 'delhivery',
      name: 'Delhivery',
      logo: '🚚',
      price: 85,
      eta: '2-3 days',
      recommended: true,
      service: 'Surface',
    },
    {
      id: 'bluedart',
      name: 'Bluedart',
      logo: '✈️',
      price: 120,
      eta: '1-2 days',
      recommended: false,
      service: 'Air',
    },
    {
      id: 'ecom',
      name: 'Ecom Express',
      logo: '📦',
      price: 95,
      eta: '2-4 days',
      recommended: false,
      service: 'Surface',
    },
    {
      id: 'xpressbees',
      name: 'Xpressbees',
      logo: '🐝',
      price: 78,
      eta: '3-4 days',
      recommended: false,
      service: 'Surface',
    },
  ];

  const handleGenerateLabel = (courierId) => {
    console.log('Generating label for courier:', courierId, 'Order:', selectedOrder.id);
    setShowRateComparison(false);
  };

  const handleDownloadManifest = () => {
    console.log('Downloading shipping manifest');
  };

  const handleCancelShipment = (shipmentId) => {
    console.log('Cancelling shipment:', shipmentId);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Shipping</h1>
          <p className="text-muted-foreground">Manage shipping labels and courier selection</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadManifest}>
            <Download className="w-4 h-4 mr-2" />
            Download Manifest
          </Button>
          <Button variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Shipments
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Shipments</p>
                <p className="text-2xl font-bold">45</p>
              </div>
              <Package className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">In Transit</p>
                <p className="text-2xl font-bold">120</p>
              </div>
              <Truck className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Delivered Today</p>
                <p className="text-2xl font-bold">28</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Exceptions</p>
                <p className="text-2xl font-bold">8</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Courier Rate Comparison Modal */}
      {showRateComparison && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle>Courier Rate Comparison</CardTitle>
            <CardDescription>
              Order: {selectedOrder.id} | Weight: 0.5kg | Destination: {selectedOrder.location}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              {courierOptions.map((courier) => (
                <Card 
                  key={courier.id} 
                  className={courier.recommended ? 'border-primary bg-primary/5' : ''}
                >
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-4xl mb-2">{courier.logo}</div>
                      <h3 className="font-bold text-lg mb-1">{courier.name}</h3>
                      <p className="text-sm text-muted-foreground mb-3">{courier.service}</p>
                      <div className="text-2xl font-bold mb-1">{formatINR(courier.price)}</div>
                      <p className="text-sm text-muted-foreground mb-3">ETA: {courier.eta}</p>
                      {courier.recommended && (
                        <Badge className="mb-3">Recommended</Badge>
                      )}
                      <Button 
                        className="w-full" 
                        size="sm"
                        onClick={() => handleGenerateLabel(courier.id)}
                      >
                        Ship with {courier.name}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button variant="outline" onClick={() => setShowRateComparison(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Shipments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Shipments Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>AWB Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.slice(0, 10).map((shipment) => {
                const order = orders.find(o => o.id === shipment.orderId);
                return (
                  <TableRow key={shipment.id}>
                    <TableCell className="font-medium">{shipment.orderId}</TableCell>
                    <TableCell>{order?.customerName || 'N/A'}</TableCell>
                    <TableCell>
                      {order?.channel === 'Amazon' || order?.channel === 'Myntra' ? (
                        <Badge variant="outline" className="gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Marketplace Courier
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{order?.channel || 'N/A'}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{shipment.courier}</TableCell>
                    <TableCell className="font-mono">{shipment.awb}</TableCell>
                    <TableCell>
                      <Badge variant={
                        shipment.status === 'Delivered' ? 'outline' :
                        shipment.status === 'In Transit' ? 'default' :
                        'secondary'
                      }>
                        {shipment.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm">{shipment.eta}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {!shipment.awb && order?.channel === 'Shopify' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setSelectedOrder(order);
                              setShowRateComparison(true);
                            }}
                          >
                            Generate Label
                          </Button>
                        )}
                        {shipment.awb && (
                          <>
                            <Button variant="ghost" size="sm">Track</Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-destructive"
                              onClick={() => handleCancelShipment(shipment.id)}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Courier Selection</p>
              <p className="text-sm text-muted-foreground">
                For Shopify orders, compare courier rates and generate labels using your own courier accounts. 
                Amazon and Myntra orders use their respective marketplace couriers automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}