import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Plug, RefreshCw, AlertTriangle, CheckCircle, Settings } from 'lucide-react';

export default function IntegrationManagementPage() {
  const integrations = [
    {
      id: 'shopify',
      name: 'Shopify',
      status: 'Connected',
      lastSync: '2024-09-08 10:30 AM',
      failedJobs: 0,
      autoSync: true,
      syncInterval: '15 minutes',
    },
    {
      id: 'amazon',
      name: 'Amazon',
      status: 'Connected',
      lastSync: '2024-09-08 09:15 AM',
      failedJobs: 2,
      autoSync: true,
      syncInterval: '30 minutes',
    },
    {
      id: 'myntra',
      name: 'Myntra',
      status: 'Connected',
      lastSync: '2024-09-08 08:45 AM',
      failedJobs: 0,
      autoSync: true,
      syncInterval: '1 hour',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Integration Management</h1>
        <p className="text-muted-foreground">Manage marketplace integrations and sync settings</p>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {integrations.map(integration => (
          <Card key={integration.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Plug className="w-5 h-5" />
                    {integration.name}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    <Badge variant={integration.status === 'Connected' ? 'outline' : 'secondary'}>
                      {integration.status}
                    </Badge>
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm">
                  <Settings className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last Sync</span>
                  <span className="text-sm font-medium">{integration.lastSync}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Failed Jobs</span>
                  <span className={`text-sm font-medium ${integration.failedJobs > 0 ? 'text-destructive' : ''}`}>
                    {integration.failedJobs}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Auto Sync</span>
                  <span className="text-sm font-medium">{integration.autoSync ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Sync Interval</span>
                  <span className="text-sm font-medium">{integration.syncInterval}</span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Sync Now
                  </Button>
                  {integration.failedJobs > 0 && (
                    <Button variant="outline" size="sm" className="text-destructive">
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      View Errors
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration Table */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Failed Jobs</TableHead>
                <TableHead>Auto Sync</TableHead>
                <TableHead>Sync Interval</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {integrations.map(integration => (
                <TableRow key={integration.id}>
                  <TableCell className="font-medium">{integration.name}</TableCell>
                  <TableCell>
                    <Badge variant={integration.status === 'Connected' ? 'outline' : 'secondary'}>
                      {integration.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{integration.lastSync}</TableCell>
                  <TableCell>
                    {integration.failedJobs > 0 ? (
                      <Badge variant="destructive">{integration.failedJobs}</Badge>
                    ) : (
                      <Badge variant="outline">{integration.failedJobs}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={integration.autoSync ? 'outline' : 'secondary'}>
                      {integration.autoSync ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell>{integration.syncInterval}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm">
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Settings className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Sync Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Sync Configuration</CardTitle>
          <CardDescription>Configure automatic sync settings for all integrations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Global Auto Sync</p>
                <p className="text-sm text-muted-foreground">Enable automatic sync for all connected channels</p>
              </div>
              <Badge variant="outline">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Error Notifications</p>
                <p className="text-sm text-muted-foreground">Send alerts when sync jobs fail</p>
              </div>
              <Badge variant="outline">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Retry Failed Jobs</p>
                <p className="text-sm text-muted-foreground">Automatically retry failed sync jobs</p>
              </div>
              <Badge variant="outline">Enabled</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}