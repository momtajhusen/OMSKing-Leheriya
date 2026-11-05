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
import { Building, MapPin, Trash2 } from 'lucide-react';
import DeleteWarehouseDialog from '../../components/settings/DeleteWarehouseDialog';
import api, { apiError, apiFormError } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';

const STILL = 'hover:translate-y-0';

const empty = {
  code: '',
  name: '',
  type: 'physical',
  city: '',
};

const emptyPickup = {
  id: '',
  code: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  contactPerson: '',
  contactPhone: '',
};

export default function WarehousesPage() {
  const navigate = useNavigate();
  const { canInventoryAdjust } = usePermissions();
  const [rows, setRows] = useState([]);
  const [authority, setAuthority] = useState('oms');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [pickup, setPickup] = useState(null);
  const [pickupForm, setPickupForm] = useState(emptyPickup);
  const [banner, setBanner] = useState('');
  const [deleting, setDeleting] = useState(null);

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

  const openPickup = (wh) => {
    setBanner('');
    setPickup(wh);
    setPickupForm({
      id: wh.id,
      code: wh.code,
      line1: wh.address?.line1 || '',
      city: wh.address?.city || '',
      state: wh.address?.state || '',
      pincode: wh.address?.pincode || '',
      contactPerson: wh.contactPerson || '',
      contactPhone: wh.contactPhone || '',
    });
  };

  const savePickup = async () => {
    setBanner('');
    try {
      await api.patch(`/warehouses/${pickupForm.id}`, {
        address: {
          line1: pickupForm.line1,
          city: pickupForm.city,
          state: pickupForm.state,
          pincode: pickupForm.pincode,
        },
        contactPerson: pickupForm.contactPerson,
        contactPhone: pickupForm.contactPhone,
        isPickup: true,
      });
      toast.success(`${pickupForm.code} pickup saved`);
      setPickup(null);
      load();
    } catch (err) {
      setBanner(apiFormError(err).message);
    }
  };

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

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Warehouses</h1>
          <p className="text-muted-foreground">
            Inventory authority: {authority === 'oms' ? 'OMS is master' : 'Shopify is master'}.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className={STILL} onClick={() => navigate('/inventory')}>Open inventory</Button>
          <Button
            className={STILL}
            disabled={!canInventoryAdjust}
            title={canInventoryAdjust ? undefined : 'You need stock adjust permission'}
            onClick={() => { setForm(empty); setBanner(''); setOpen(true); }}
          >
            Add warehouse
          </Button>
        </div>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <Building className="w-5 h-5 text-primary mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Channel visibility</p>
              <p className="text-sm text-muted-foreground">
                Each channel sees stock only from the warehouses linked to it. Virtual stock can be linked to Shopify only.
              </p>
            </div>
            <Button size="sm" variant="outline" className={`shrink-0 ${STILL}`} onClick={() => navigate('/settings?tab=links')}>
              Manage links
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logical warehouses ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="min-h-[160px]">
          {loading && rows.length === 0 ? <PageLoader label="Loading warehouses..." /> : rows.length === 0 ? <EmptyState title="No warehouses" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Visible on</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[220px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((wh) => (
                  <TableRow key={wh.id} className="h-14">
                    <TableCell className="font-medium">{wh.code}</TableCell>
                    <TableCell>{wh.name}</TableCell>
                    <TableCell>
                      <Badge variant={wh.type === 'virtual' ? 'secondary' : 'outline'}>{wh.type}</Badge>
                    </TableCell>
                    <TableCell>{wh.channels.join(', ') || '—'}</TableCell>
                    <TableCell>{wh.isPickup ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{wh.status}</TableCell>
                    <TableCell className="w-[220px]">
                      <div className="flex items-center justify-end gap-2">
                        {wh.type === 'physical' && (
                          <Button size="sm" variant="outline" className={STILL} onClick={() => openPickup(wh)}>Pickup address</Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className={`text-destructive ${STILL}`}
                          disabled={!canInventoryAdjust}
                          aria-label={`Delete ${wh.code}`}
                          onClick={() => setDeleting(wh)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
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
                <TableHead>Channel</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>External id</TableHead>
                <TableHead>Warehouse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maps.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell className="capitalize">{loc.channel}</TableCell>
                  <TableCell>{loc.label || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{loc.externalLocationId}</TableCell>
                  <TableCell><Badge variant="outline">{loc.warehouse}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DeleteWarehouseDialog warehouse={deleting} onClose={() => setDeleting(null)} onDeleted={load} />

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

      <Modal
        open={Boolean(pickup)}
        onOpenChange={(next) => { if (!next) setPickup(null); }}
        title={`Pickup for ${pickupForm.code}`}
        footer={(
          <>
            <Button variant="outline" onClick={() => setPickup(null)}>Cancel</Button>
            <Button onClick={savePickup}>Save pickup</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <p className="text-sm text-muted-foreground">
            Delhivery uses this street, pincode, and phone for the WH-001 pickup. It does not book a shipment.
          </p>
          <div>
            <label className="text-sm font-medium">Street</label>
            <Input value={pickupForm.line1} onChange={(e) => setPickupForm({ ...pickupForm, line1: e.target.value })} placeholder="Street address" />
          </div>
          <div>
            <label className="text-sm font-medium">City</label>
            <Input value={pickupForm.city} onChange={(e) => setPickupForm({ ...pickupForm, city: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">State</label>
            <Input value={pickupForm.state} onChange={(e) => setPickupForm({ ...pickupForm, state: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Pincode</label>
            <Input value={pickupForm.pincode} onChange={(e) => setPickupForm({ ...pickupForm, pincode: e.target.value })} placeholder="6 digit pincode" />
          </div>
          <div>
            <label className="text-sm font-medium">Contact person</label>
            <Input value={pickupForm.contactPerson} onChange={(e) => setPickupForm({ ...pickupForm, contactPerson: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Phone</label>
            <Input value={pickupForm.contactPhone} onChange={(e) => setPickupForm({ ...pickupForm, contactPhone: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
