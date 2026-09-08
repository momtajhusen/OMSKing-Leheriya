import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Building2, Plus, ArrowRight, CheckCircle, Upload, Link } from 'lucide-react';

export default function TenantMgmtPage() {
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  const tenants = [
    { id: 'TNT-001', name: 'Leheriya Creations', status: 'Active', type: 'Production', channels: 3, lastSync: '2024-09-08 10:30 AM' },
    { id: 'TNT-002', name: 'Demo Tenant 2', status: 'Trial', type: 'Trial', channels: 1, lastSync: '2024-09-07 04:15 PM' },
    { id: 'TNT-003', name: 'Test Tenant', status: 'Inactive', type: 'Development', channels: 0, lastSync: 'Never' },
  ];

  const handleStartWizard = () => {
    setShowWizard(true);
    setWizardStep(1);
  };

  const handleNextStep = () => {
    if (wizardStep < 3) {
      setWizardStep(wizardStep + 1);
    } else {
      setShowWizard(false);
      setWizardStep(1);
    }
  };

  const handlePreviousStep = () => {
    if (wizardStep > 1) {
      setWizardStep(wizardStep - 1);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Tenant/Merchant Management</h1>
          <p className="text-muted-foreground">Manage multi-tenant accounts and onboarding</p>
        </div>
        <Button onClick={handleStartWizard}>
          <Plus className="w-4 h-4 mr-2" />
          New Tenant
        </Button>
      </div>

      {/* Business Rule Info */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Building2 className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">New Tenant Onboarding Flow</p>
              <p className="text-sm text-muted-foreground">
                Import products channel-wise: Shopify → Myntra → Amazon. 
                Same SKU items are auto-mapped to existing Master SKU codes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* New Tenant Wizard */}
      {showWizard && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle>New Tenant Onboarding Wizard</CardTitle>
            <CardDescription>Step {wizardStep} of 3: Import products from sales channels</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Wizard Steps */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${wizardStep >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {wizardStep > 1 ? <CheckCircle className="w-4 h-4" /> : '1'}
                  </div>
                  <span className={wizardStep >= 1 ? 'font-medium' : 'text-muted-foreground'}>Shopify</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${wizardStep >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {wizardStep > 2 ? <CheckCircle className="w-4 h-4" : '2'}
                  </div>
                  <span className={wizardStep >= 2 ? 'font-medium' : 'text-muted-foreground'}>Myntra</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${wizardStep >= 3 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    {wizardStep > 3 ? <CheckCircle className="w-4 h-4" /> : '3'}
                  </div>
                  <span className={wizardStep >= 3 ? 'font-medium' : 'text-muted-foreground'}>Amazon</span>
                </div>
              </div>
            </div>

            {/* Step Content */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <h3 className="font-medium">Step 1: Import from Shopify</h3>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground mb-4">Connect to Shopify store or upload product file</p>
                  <Button variant="outline">
                    <Link className="w-4 h-4 mr-2" />
                    Connect Shopify
                  </Button>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                  <p className="text-sm text-green-800 dark:text-green-200">
                    <CheckCircle className="w-4 h-4 inline mr-2" />
                    Same SKU items will be auto-mapped to existing Master SKU codes
                  </p>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4">
                <h3 className="font-medium">Step 2: Import from Myntra</h3>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground mb-4">Connect to Myntra partner account or upload product file</p>
                  <Button variant="outline">
                    <Link className="w-4 h-4 mr-2" />
                    Connect Myntra
                  </Button>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <Link className="w-4 h-4 inline mr-2" />
                    Products from Myntra will be mapped to existing SKUs where possible
                  </p>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-4">
                <h3 className="font-medium">Step 3: Import from Amazon</h3>
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground mb-4">Connect to Amazon Seller Central or upload product file</p>
                  <Button variant="outline">
                    <Link className="w-4 h-4 mr-2" />
                    Connect Amazon
                  </Button>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <CheckCircle className="w-4 h-4 inline mr-2" />
                    Final step: Complete product catalog import and mapping
                  </p>
                </div>
              </div>
            )}

            {/* Wizard Actions */}
            <div className="flex justify-between mt-6 pt-4 border-t">
              <Button
                variant="outline"
                onClick={handlePreviousStep}
                disabled={wizardStep === 1}
              >
                Previous
              </Button>
              <Button onClick={handleNextStep}>
                {wizardStep === 3 ? 'Complete' : 'Next'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tenant Table */}
      <Card>
        <CardHeader>
          <CardTitle>Tenant List ({tenants.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map(tenant => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">{tenant.id}</TableCell>
                  <TableCell>{tenant.name}</TableCell>
                  <TableCell>
                    <Badge variant={tenant.status === 'Active' ? 'outline' : 'secondary'}>
                      {tenant.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{tenant.type}</TableCell>
                  <TableCell>{tenant.channels}</TableCell>
                  <TableCell>{tenant.lastSync}</TableCell>
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