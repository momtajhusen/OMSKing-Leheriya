import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Modal from '../../components/ui/Modal';
import PageLoader from '../../components/ui/PageLoader';
import EmptyState from '../../components/ui/EmptyState';
import { FormBanner } from '../../components/ui/FormBanner';
import { Building, MapPin } from 'lucide-react';
import api, { apiError, apiFormError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const empty = {
  code: '',
  name: '',
  type: 'physical',
  city: '',
};

export default function WarehousesPage() {
  const navigate = useNavigate();
  const { canInventoryAdjust } = usePermissions();
  const [rows, setRows] = useState([]);
  const [authority, setAuthority] = useState('oms');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [banner, setBanner] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/warehouses');
      setRows(data.data?.warehouses || []);
      setAuthority(data.data?.inventoryAuthority || 'oms');
    } catch (err) {
      toast.error(apiError(err, 'Could not load warehouses'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const maps = useMemo(
    () => rows.flatMap((wh) => (wh.locations || []).map((loc) => ({ ...loc, warehouse: wh.code, usedBy: wh.channels.join(', ') }))),
    [rows],
  );

  const save = async () => {
    setBanner('');
    try {
      await api.post('/warehouses', {
        code: form.code,
        name: form.name,
        type: form.type,
        address: { city: form.city },
        sellOnShopify: true,
        sellOnAmazon: form.type === 'physical',
        sellOnMyntra: form.type === 'physical',
      });
      toast.success('Warehouse saved');
      setOpen(false);
      setForm(empty);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

  if (loading) return <PageLoader label="Loading warehouses..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Warehouses</h1>
          <p className="text-muted-foreground">
            WH-001 is physical (Shopify + Amazon + Myntra). WH-002 is virtual (Shopify only). Inventory authority: {authority === 'oms' ? 'OMS is master' : 'Shopify is master'}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/inventory')}>Open inventory</Button>
          {canInventoryAdjust && (
            <Button onClick={() => { setForm(empty); setBanner(''); setOpen(true); }}>Add warehouse</Button>
          )}
        </div>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Building className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Channel visibility</p>
              <p className="text-sm text-muted-foreground">
                Offline stock is sellable on all three channels. Virtual stock is Shopify only — Amazon and Myntra never see WH-002.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logical warehouses ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? <EmptyState title="No warehouses" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Visible on</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((wh) => (
                  <TableRow key={wh.id}>
                    <TableCell className="font-medium">{wh.code}</TableCell>
                    <TableCell>{wh.name}</TableCell>
                    <TableCell>
                      <Badge variant={wh.type === 'virtual' ? 'secondary' : 'outline'}>{wh.type}</Badge>
                    </TableCell>
                    <TableCell>{wh.channels.join(', ') || '—'}</TableCell>
                    <TableCell>{wh.isPickup ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{wh.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Channel location map</CardTitle>
          <CardDescription>A Shopify location is not automatically a warehouse. This table is the explicit map.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel location</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Used by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maps.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell>{loc.label || loc.externalLocationId}</TableCell>
                  <TableCell><Badge variant="outline">{loc.warehouse}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{loc.usedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add warehouse"
        footer={(
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <div>
            <label className="text-sm font-medium">Code</label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="WH-003" />
          </div>
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="physical">physical (all channels)</option>
              <option value="virtual">virtual (Shopify only)</option>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">City</label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
