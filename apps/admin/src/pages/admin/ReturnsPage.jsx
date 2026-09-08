import { useState } from 'react';
import { returns, orders } from '../../mocks';
import { formatINR, formatDate, statusBadgeVariant } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { RotateCcw, Package, CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';

export default function ReturnsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [selectedReturns, setSelectedReturns] = useState({});

  const handleRestockChange = (returnId, destination) => {
    setSelectedReturns(prev => ({
      ...prev,
      [returnId]: destination
    }));
  };

  const handleApproveReturn = (returnId) => {
    console.log('Approving return:', returnId, 'Restock to:', selectedReturns[returnId]);
  };

  const handleRejectReturn = (returnId) => {
    console.log('Rejecting return:', returnId);
  };

  const statusTabs = ['all', 'pending', 'approved', 'rejected', 'completed'];

  const filteredReturns = returns.filter(ret => {
    return activeTab === 'all' || ret.status.toLowerCase() === activeTab;
  });

  const kpiData = {
    total: returns.length,
    pending: returns.filter(r => r.status === 'Pending').length,
    approved: returns.filter(r => r.status === 'Approved').length,
    rejected: returns.filter(r => r.status === 'Rejected').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Returns</h1>
          <p className="text-muted-foreground">Manage return requests and restock destinations</p>
        </div>
        <Button variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Sync Returns
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Returns</p>
                <p className="text-2xl font-bold">{kpiData.total}</p>
              </div>
              <RotateCcw className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">{kpiData.pending}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Approved</p>
                <p className="text-2xl font-bold">{kpiData.approved}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rejected</p>
                <p className="text-2xl font-bold">{kpiData.rejected}</p>
              </div>
              <XCircle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-2">
        {statusTabs.map(tab => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
      </div>

      {/* Restock Destination Info */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Package className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Restock Destination Configuration</p>
              <p className="text-sm text-muted-foreground">
                Configure where returned items should be restocked. Options include all warehouses, 
                specific channels (Shopify Offline, Amazon, Myntra), or no restock.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Returns Table */}
      <Card>
        <CardHeader>
          <CardTitle>Return Requests ({filteredReturns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Return ID</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Restock Destination</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReturns.map((ret) => {
                const order = orders.find(o => o.id === ret.orderId);
                return (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">{ret.id}</TableCell>
                    <TableCell>{ret.orderId}</TableCell>
                    <TableCell>{order?.customerName || 'N/A'}</TableCell>
                    <TableCell>{ret.reason}</TableCell>
                    <TableCell>{formatINR(ret.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(ret.status)}>
                        {ret.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {ret.status === 'Pending' ? (
                        <div className="space-y-1">
                          {['All', 'Shopify (Offline)', 'Amazon', 'Myntra', 'None'].map((dest) => (
                            <label key={dest} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`restock-${ret.id}`}
                                value={dest}
                                checked={selectedReturns[ret.id] === dest}
                                onChange={() => handleRestockChange(ret.id, dest)}
                                className="w-4 h-4"
                              />
                              {dest}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {selectedReturns[ret.id] || 'Not specified'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {ret.status === 'Pending' && (
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleApproveReturn(ret.id)}
                            disabled={!selectedReturns[ret.id]}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="text-destructive"
                            onClick={() => handleRejectReturn(ret.id)}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                      {ret.status === 'Approved' && (
                        <Badge variant="outline">QC Pending</Badge>
                      )}
                      {ret.status === 'Completed' && (
                        <Badge variant="outline">Restocked</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Restock Legend */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="font-medium mb-3">Restock Destination Options</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">All</p>
                <p className="text-muted-foreground">Restock to all available warehouses</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Shopify (Offline)</p>
                <p className="text-muted-foreground">Restock to Shopify offline warehouse only</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium">Amazon/Myntra</p>
                <p className="text-muted-foreground">Restock to marketplace warehouses</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-destructive mt-0.5" />
              <div>
                <p className="font-medium">None</p>
                <p className="text-muted-foreground">Do not restock (dispose or hold)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}