import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatINR, formatDateTime } from '../../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import ProductThumb from '../../components/ui/ProductThumb';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/Tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/Table';
import api, { apiError } from '../../lib/api';
import { orderChannelLabel } from '../../constants/channelCatalog';
import useConnectedChannels from '../../hooks/useConnectedChannels';

function FieldRows({ rows }) {
  return (
    <dl className="divide-y divide-[hsl(var(--color-border-premium))] text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(8rem,40%)_1fr] gap-3 py-2 odd:bg-muted/40 px-2">
          <dt className="font-medium">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const dash = (value) => (value === null || value === undefined || value === '' ? '—' : value);

const SYNC_BADGE = {
  synced: ['Sync On', 'default'],
  pending: ['Sync pending', 'outline'],
  error: ['Sync error', 'destructive'],
  unmapped: ['Not synced', 'outline'],
};

function ChannelListings({ listings }) {
  if (!listings.length) {
    return <EmptyState title="No channel listings" description="Map this Master SKU to a Shopify, Amazon or Myntra listing to see it here." />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Channel</TableHead>
          <TableHead>Channel listing / SKU code / Name</TableHead>
          <TableHead>Linked inventory</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Listed qty</TableHead>
          <TableHead>Retail price</TableHead>
          <TableHead>Selling price</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {listings.flatMap((row, index) => {
          const [syncLabel, syncVariant] = SYNC_BADGE[row.syncStatus] || SYNC_BADGE.unmapped;
          const out = [];
          if (row.group === 'shopify_virtual' && listings[index - 1]?.group !== 'shopify_virtual' && index > 0) {
            out.push(
              <TableRow key={`gap-${row.id}`} className="hover:bg-transparent">
                <TableCell colSpan={7} className="max-w-none py-3"><div className="border-t-2 border-dashed border-[hsl(var(--color-border-premium))]" /></TableCell>
              </TableRow>,
            );
          }
          out.push(
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="max-w-[28rem]">
                <div className="flex gap-3">
                  {row.imageUrl ? <ProductThumb name={row.title || row.channelSkuCode} sku={row.channelSkuCode} src={row.imageUrl} /> : null}
                  <div className="space-y-0.5">
                    <p className="font-medium text-primary">{row.channelSkuCode}</p>
                    {row.title ? <p><span className="font-medium">Name:</span> {row.title}</p> : null}
                    {row.channelProductId ? (
                      <p className="text-xs text-muted-foreground">
                        Listing ID:{' '}
                        {row.listingUrl ? (
                          <a href={row.listingUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline" title={`View on ${row.channelName}`}>{row.channelProductId}</a>
                        ) : row.channelProductId}
                      </p>
                    ) : null}
                    <p className="text-xs"><span className="font-medium">Mapped On:</span> {row.mappedAt ? formatDateTime(row.mappedAt) : '—'}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>{row.warehouseName || row.warehouse} ({row.warehouse})</TableCell>
              <TableCell><Badge variant={syncVariant}>{syncLabel}</Badge></TableCell>
              <TableCell className="font-semibold">{row.listedQty}</TableCell>
              <TableCell>{formatINR(row.mrp)}</TableCell>
              <TableCell>{row.sellingPrice === null ? '—' : formatINR(row.sellingPrice)}</TableCell>
            </TableRow>,
          );
          return out;
        })}
      </TableBody>
    </Table>
  );
}

export default function ProductStockPage() {
  const { masterSkuId } = useParams();
  const navigate = useNavigate();
  const connected = useConnectedChannels();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/inventory/sku/${masterSkuId}`)
      .then(({ data: res }) => {
        setData(res.data);
        setWarehouseId(res.data?.warehouses?.[0]?.warehouseId || '');
      })
      .catch((err) => setError(apiError(err, 'Could not load this product')))
      .finally(() => setLoading(false));
  }, [masterSkuId]);

  if (loading) return <PageLoader label="Loading product..." />;

  const back = <Button variant="outline" size="sm" onClick={() => navigate('/inventory')}><ArrowLeft className="w-4 h-4 mr-1" />Inventory</Button>;

  if (error || !data) {
    return (
      <div className="space-y-3">
        {back}
        <EmptyState title="Product not found" description={error || 'This Master SKU does not exist in your account.'} />
      </div>
    );
  }

  const { sku, warehouses, listings = [] } = data;
  const wh = warehouses.find((row) => row.warehouseId === warehouseId) || warehouses[0];
  const dims = sku.dimensionsCm;
  const variant = Object.entries(sku.variantAttributes || {}).map(([key, value]) => `${key}: ${value}`).join(' · ');

  const left = [
    ['Image', <ProductThumb key="img" name={sku.name || sku.code} sku={sku.code} src={sku.imageUrl} size="lg" />],
    ['Sku Code', sku.code],
    ['Name', sku.name],
    ['Variant', dash(variant)],
    ['Product Category', dash(sku.category)],
    ['GST Tax', sku.gstRatePercent === null ? '—' : `${sku.gstRatePercent}%`],
    ['HSN Code', dash(sku.hsnCode)],
    ['Barcode', dash(sku.barcode)],
    ['Date Created', sku.createdAt ? formatDateTime(sku.createdAt) : '—'],
  ];
  const right = [
    ['Status', <Badge key="status" variant={sku.status === 'active' ? 'default' : 'outline'}>{sku.status === 'active' ? 'Active' : 'Discontinued'}</Badge>],
    ['Package (L×W×H cm)', dims.l || dims.w || dims.h ? `L${dims.l} W${dims.w} H${dims.h}` : '—'],
    ['Weight', sku.weightKg ? `${Math.round(sku.weightKg * 1000)} g` : '—'],
    ['Retail Price (MRP)', formatINR(sku.mrp)],
    ['Selling Price', formatINR(sku.sellingPrice)],
    ['Last Purchase Price', formatINR(sku.costPrice)],
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <h1 className="text-xl font-bold">
          <span className="text-muted-foreground">Product / </span>{sku.code}
        </h1>
      </div>

      <Tabs defaultValue="details" className="space-y-3">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="listings">Channel Listings</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-2">
                <FieldRows rows={left} />
                <FieldRows rows={right} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex gap-2 overflow-x-auto">
                {warehouses.map((row) => (
                  <Button key={row.warehouseId} size="sm" className="whitespace-nowrap" variant={row.warehouseId === wh?.warehouseId ? 'default' : 'outline'} onClick={() => setWarehouseId(row.warehouseId)}>
                    {row.warehouseName || row.warehouse}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {!wh ? (
                <EmptyState title="No warehouses" description="Add a warehouse to track stock for this product." />
              ) : (
                <div className="space-y-3">
                  <p className="text-base">Inventory detail for {wh.warehouseName || wh.warehouse} - {wh.warehouse} ({wh.warehouseType})</p>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <FieldRows
                      rows={[
                        ['Status', !wh.tracked ? <Badge key="s" variant="outline">Not received</Badge> : wh.low ? <Badge key="s" variant="destructive">Low stock</Badge> : <Badge key="s">Active</Badge>],
                        ['In Stock', wh.stock],
                        ['Reserved', wh.reserved],
                        ['Available', wh.available],
                        ['Low-stock threshold', wh.reorderPoint],
                      ]}
                    />
                    <FieldRows
                      rows={[
                        ['Manual Adjustments', wh.counts.manualAdjustments],
                        ['Purchased Count', wh.counts.purchased],
                        ['Shipped Count', wh.counts.shipped],
                        ['Returned Count', wh.counts.returned],
                      ]}
                    />
                    <FieldRows
                      rows={[
                        ['Visible on', wh.channels.map((id) => {
                          const channel = connected.channels.find((item) => item.id === id);
                          return channel ? orderChannelLabel(channel) : id;
                        }).join(', ') || '—'],
                        ['Last Sold On', wh.counts.lastSoldAt ? formatDateTime(wh.counts.lastSoldAt) : '—'],
                        ['Last Movement', wh.counts.lastMovementAt ? formatDateTime(wh.counts.lastMovementAt) : '—'],
                      ]}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="listings">
          <Card>
            <CardHeader>
              <CardTitle>Channel Listings</CardTitle>
            </CardHeader>
            <CardContent>
              <ChannelListings listings={listings} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
