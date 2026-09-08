import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/Alert';
import { Loader, Skeleton } from '../../components/ui/Loader';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import Avatar from '../../components/ui/Avatar';
import Tag from '../../components/ui/Tag';
import Modal from '../../components/ui/Modal';
import Drawer from '../../components/ui/Drawer';
import EmptyState from '../../components/ui/EmptyState';
import KpiCard from '../../components/ui/KpiCard';
import Breadcrumbs from '../../components/ui/Breadcrumbs';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../../components/ui/DropdownMenu';
import { toast } from 'react-hot-toast';
import { Package, Search, Inbox, MoreHorizontal, ShoppingCart, TrendingUp } from 'lucide-react';

function Section({ title, description, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function UiShowcasePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tags, setTags] = useState(['Shopify', 'Amazon', 'Myntra']);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">UI Showcase</h1>
        <p className="text-muted-foreground">
          Every shared component in the design system, in one place — the reference for keeping
          all 23 modules visually consistent.
        </p>
      </div>

      <Section title="Buttons" description="Six variants across four sizes">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon"><Package className="w-4 h-4" /></Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </div>
      </Section>

      <Section title="Badges & Tags" description="Status pills and removable tags">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map(tag => (
              <Tag key={tag} onClose={() => setTags(tags.filter(t => t !== tag))}>
                {tag}
              </Tag>
            ))}
            {tags.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => setTags(['Shopify', 'Amazon', 'Myntra'])}>
                Reset tags
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Form Controls" description="Inputs, selects and text areas used across every form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Text input</label>
            <Input placeholder="Master SKU code" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">With icon</label>
            <Input placeholder="Search orders…" iconLeft={<Search className="w-4 h-4" />} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">With error</label>
            <Input placeholder="GSTIN" error="GSTIN must be 15 characters" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Select</label>
            <Select defaultValue="Delhivery">
              <option>Delhivery</option>
              <option>Bluedart</option>
              <option>Ecom Express</option>
              <option>Xpressbees</option>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">Textarea</label>
            <Textarea rows={3} placeholder="QC notes…" />
          </div>
        </div>
      </Section>

      <Section title="KPI Cards" description="The stat tile used on every dashboard and list page">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Revenue" value="₹59,50,000" delta={23.5} icon={TrendingUp} />
          <KpiCard label="Orders" value={725} delta={15.2} icon={ShoppingCart} />
          <KpiCard label="Return Rate" value="4.2%" delta={-0.8} icon={Package} />
          <KpiCard label="Active Vendors" value={12} icon={Package} />
        </div>
      </Section>

      <Section title="Table" description="Standard data table used by every list screen">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">65207-LEH</TableCell>
              <TableCell>Rahul Sharma</TableCell>
              <TableCell><Badge variant="outline">Shopify</Badge></TableCell>
              <TableCell><Badge>New</Badge></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">65209-LEH</TableCell>
              <TableCell>Amit Kumar</TableCell>
              <TableCell><Badge variant="outline">Myntra</Badge></TableCell>
              <TableCell><Badge variant="outline">Delivered</Badge></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Tabs" description="Segmented control for switching views within a page">
        <Tabs defaultValue="offline">
          <TabsList>
            <TabsTrigger value="offline">Offline Warehouse</TabsTrigger>
            <TabsTrigger value="virtual">Virtual Warehouse</TabsTrigger>
          </TabsList>
          <TabsContent value="offline">
            <p className="text-sm text-muted-foreground pt-2">
              Offline stock is sellable on Shopify, Amazon and Myntra.
            </p>
          </TabsContent>
          <TabsContent value="virtual">
            <p className="text-sm text-muted-foreground pt-2">
              Virtual stock is shown on Shopify only.
            </p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Alerts" description="Inline messaging in four severities">
        <div className="space-y-3">
          <Alert>
            <AlertTitle>Sync scheduled</AlertTitle>
            <AlertDescription>Channel inventory sync runs every 15 minutes.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <AlertTitle>Payment file matched</AlertTitle>
            <AlertDescription>18 of 20 Amazon settlements were matched automatically.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <AlertTitle>Low stock</AlertTitle>
            <AlertDescription>4 SKUs in WH-001 are below their reorder point.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Mapping failed</AlertTitle>
            <AlertDescription>MYN-CSS-PK-002 could not sync — price mismatch.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section title="Overlays" description="Modal, drawer, dropdown menu and toast">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setModalOpen(true)}>Open Modal</Button>
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
          <DropdownMenu trigger={<Button variant="outline"><MoreHorizontal className="w-4 h-4" /></Button>}>
            <DropdownMenuItem onClick={() => toast.success('Label generated')}>Generate Label</DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast('Order marked packed')}>Mark Packed</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => toast.error('Order cancelled')}>Cancel Order</DropdownMenuItem>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast.success('Saved successfully')}>Show Toast</Button>
        </div>
      </Section>

      <Section title="Avatars & Breadcrumbs" description="Identity and navigation primitives">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar fallback="MH" />
            <Avatar alt="Leheriya Creations" />
            <Avatar alt="Sandeep Textiles" />
          </div>
          <Breadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: '65207-LEH' }]} />
        </div>
      </Section>

      <Section title="Loading & Empty States" description="What every screen shows before data arrives">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <Loader size="sm" />
              <Loader />
              <Loader size="lg" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            icon={<Inbox className="w-8 h-8 text-muted-foreground" />}
            title="No unmapped listings"
            description="Every channel listing is mapped to a Master SKU."
            action={<Button variant="outline" size="sm">Re-run mapping</Button>}
          />
        </div>
      </Section>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Cancel shipping label"
        description="The order will revert to Unfulfilled and sync back to Shopify."
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Keep label</Button>
            <Button variant="destructive" onClick={() => setModalOpen(false)}>Cancel label</Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          AWB DLV1234567890 will be cancelled with Delhivery. This cannot be undone.
        </p>
      </Modal>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Order 65207-LEH">
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-muted-foreground">Customer</p>
            <p className="font-medium">Rahul Sharma · Jaipur, Rajasthan</p>
          </div>
          <div>
            <p className="text-muted-foreground">Channel</p>
            <p className="font-medium">Shopify · COD</p>
          </div>
          <div>
            <p className="text-muted-foreground">Items</p>
            <p className="font-medium">Leheriya Kurta Blue × 2, Cotton Saree Pink × 1</p>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
