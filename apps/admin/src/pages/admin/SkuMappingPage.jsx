import { useState } from 'react';
import { skuMappings, masterSkus } from '../../mocks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { GitCompare, Plus, Search, Link, Unlink } from 'lucide-react';

export default function SkuMappingPage() {
  const [activeTab, setActiveTab] = useState('mapped');
  const [mappingInput, setMappingInput] = useState({});

  const handleMapToExisting = (mappingId, masterSku) => {
    console.log('Mapping', mappingId, 'to existing master SKU:', masterSku);
  };

  const handleCreateAsNew = (mappingId) => {
    console.log('Creating new product for mapping:', mappingId);
  };

  const tabs = [
    { id: 'mapped', label: 'Mapped Listings', count: skuMappings.filter(m => m.status === 'Synced').length },
    { id: 'unmapped', label: 'Unmapped Listings', count: skuMappings.filter(m => m.status !== 'Synced').length },
  ];

  const filteredMappings = skuMappings.filter(m => {
    return activeTab === 'mapped' ? m.status === 'Synced' : m.status !== 'Synced';
  });

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">SKU Mapping</h1>
          <p className="text-muted-foreground">Map channel SKUs to master SKU codes</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Create Mapping
        </Button>
      </div>

      {/* Business Rule Info */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <GitCompare className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">SKU Mapping Decision Flow</p>
              <p className="text-sm text-muted-foreground">
                For unmapped listings, check if the product exists on another channel. 
                If yes, auto-map to existing Master SKU. If no, either create as new product 
                or manually map by entering Master SKU code.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label} ({tab.count})
          </Button>
        ))}
      </div>

      {/* Mapped Listings */}
      {activeTab === 'mapped' && (
        <Card>
          <CardHeader>
            <CardTitle>Successfully Mapped Listings</CardTitle>
            <CardDescription>Channel SKUs mapped to master SKU codes</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel SKU</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Master SKU</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.slice(0, 10).map(mapping => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">{mapping.channelSku}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{mapping.channel}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link className="w-4 h-4 text-green-600" />
                        {mapping.masterSku}
                      </div>
                    </TableCell>
                    <TableCell>{mapping.productName}</TableCell>
                    <TableCell>{mapping.lastSync}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{mapping.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Unmapped Listings */}
      {activeTab === 'unmapped' && (
        <Card>
          <CardHeader>
            <CardTitle>Unmapped Listings</CardTitle>
            <CardDescription>Channel SKUs requiring mapping to master SKU</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel SKU</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Map to Existing Master SKU</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.slice(0, 10).map(mapping => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Unlink className="w-4 h-4 text-destructive" />
                        {mapping.channelSku}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{mapping.channel}</Badge>
                    </TableCell>
                    <TableCell>{mapping.productName}</TableCell>
                    <TableCell>
                      <Badge variant={mapping.status === 'Error' ? 'destructive' : 'secondary'}>
                        {mapping.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Enter Master SKU"
                          className="w-32 px-2 py-1 border rounded text-sm"
                          value={mappingInput[mapping.id] || ''}
                          onChange={(e) => setMappingInput(prev => ({
                            ...prev,
                            [mapping.id]: e.target.value
                          }))}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMapToExisting(mapping.id, mappingInput[mapping.id])}
                          disabled={!mappingInput[mapping.id]}
                        >
                          Map
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCreateAsNew(mapping.id)}
                        >
                          Create as New
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Master SKU Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Available Master SKUs</CardTitle>
          <CardDescription>Reference for manual mapping</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Master SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Variant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {masterSkus.slice(0, 10).map(sku => (
                <TableRow key={sku.id}>
                  <TableCell className="font-medium">{sku.code}</TableCell>
                  <TableCell>{sku.productName}</TableCell>
                  <TableCell>
                    {Object.entries(sku.attributes).map(([key, value]) => (
                      <span key={key} className="text-sm mr-2">
                        {key}: {value}
                      </span>
                    ))}
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