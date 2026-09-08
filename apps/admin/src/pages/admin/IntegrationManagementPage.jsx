import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';
import useChannelStore from '../../stores/channelStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Plug, RefreshCw, AlertTriangle, Settings } from 'lucide-react';

export default function IntegrationManagementPage() {
  const catalog = useChannelStore((s) => s.catalog);
  const enabledIds = useChannelStore((s) => s.enabledIds);
  const connections = useChannelStore((s) => s.connections);

  const integrations = catalog
    .filter((c) => enabledIds.includes(c.id))
    .map((c) => ({
      ...c,
      ...(connections[c.id] || { status: 'Not configured', lastSync: 'Never', failedJobs: 0 }),
    }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Integration Management</h1>
          <p className="text-muted-foreground">
            Health for the channels this tenant selected. Add or remove channels, then save API keys, from Channels.
          </p>
        </div>
        <Link to="/channels">
          <Button>
            <Settings className="w-4 h-4 mr-2" />
            Select channels & API
          </Button>
        </Link>
      </div>

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No channels selected yet.{' '}
            <Link to="/channels" className="text-primary underline">
              Choose marketplaces
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {integrations.map((integration) => (
            <Card key={integration.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plug className="w-5 h-5" />
                  {integration.name}
                </CardTitle>
                <CardDescription>
                  <Badge variant={integration.status === 'Connected' ? 'outline' : 'secondary'}>
                    {integration.status}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last Sync</span>
                  <span>{integration.lastSync}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Failed Jobs</span>
                  <span className={integration.failedJobs > 0 ? 'text-destructive' : ''}>
                    {integration.failedJobs}
                  </span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => toast.success(`Sync queued for ${integration.name}`)}
                  >
                    <RefreshCw className="w-4 h-4 mr-1" />
                    Sync Now
                  </Button>
                  {integration.failedJobs > 0 && (
                    <Button variant="outline" size="sm" className="text-destructive">
                      <AlertTriangle className="w-4 h-4 mr-1" />
                      Errors
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {integrations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Integration Status</CardTitle>
            <CardDescription>Only selected channels appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Failed Jobs</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {integrations.map((integration) => (
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
                      <Link to="/channels" className="text-sm text-primary hover:underline">
                        API config
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
