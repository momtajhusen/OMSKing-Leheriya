import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Download, History, Link2, Pencil, Plus, Star, Trash2, Warehouse } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import { FormBanner } from '../ui/FormBanner';
import DeleteWarehouseDialog from './DeleteWarehouseDialog';
import api, { apiError, apiFormError } from '../../lib/api';
import {
  groupLinks, linkableWarehouses, channelsForType, linkCount, backupFileName, historyTime,
} from '../../lib/channelWarehouse';

const STILL = 'hover:translate-y-0';
const blankWarehouse = { id: '', code: '', name: '', type: 'physical', status: 'active', channels: [] };
const blankLink = { id: '', channel: '', warehouseId: '', externalLocationId: '', label: '', isPrimaryForChannel: false };

export default function ChannelWarehouseSettings() {
  const [data, setData] = useState({ connections: [], channels: [], warehouses: [] });
  const [loaded, setLoaded] = useState(false);
  const [whForm, setWhForm] = useState(null);
  const [linkForm, setLinkForm] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [banner, setBanner] = useState('');
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState([]);
  const [exporting, setExporting] = useState('');

  const load = async () => {
    try {
      const [res, log] = await Promise.all([
        api.get('/warehouses/links'),
        api.get('/warehouses/links/history', { params: { limit: 25 } }).catch(() => null),
      ]);
      setData(res.data.data || { connections: [], channels: [], warehouses: [] });
      if (log) setHistory(log.data.data || []);
    } catch (err) {
      toast.error(apiError(err, 'Could not load channel and warehouse links'));
    } finally {
      setLoaded(true);
    }
  };

  const download = async (format) => {
    setExporting(format);
    try {
      const res = await api.get('/warehouses/links/export', { params: { format }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName(format);
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Backup downloaded (${format.toUpperCase()})`);
    } catch (err) {
      toast.error(apiError(err, 'Could not download the backup'));
    } finally {
      setExporting('');
    }
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => groupLinks(data.channels, data.connections), [data]);

  const run = async (fn, done) => {
    setBanner('');
    setSaving(true);
    try {
      await fn();
      toast.success(done);
      await load();
      return true;
    } catch (err) {
      setBanner(apiFormError(err).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveWarehouse = async () => {
    const editing = Boolean(whForm.id);
    const ok = await run(
      () => (editing
        ? api.patch(`/warehouses/${whForm.id}`, { name: whForm.name, status: whForm.status })
        : api.post('/warehouses', { code: whForm.code, name: whForm.name, type: whForm.type, channels: whForm.channels })),
      editing ? 'Warehouse saved' : 'Warehouse added',
    );
    if (ok) setWhForm(null);
  };

  const saveLink = async () => {
    const editing = Boolean(linkForm.id);
    const ok = await run(
      () => (editing
        ? api.patch(`/warehouses/links/${linkForm.id}`, {
          warehouseId: linkForm.warehouseId,
          externalLocationId: linkForm.externalLocationId,
          label: linkForm.label,
          isPrimaryForChannel: linkForm.isPrimaryForChannel,
        })
        : api.post('/warehouses/links', linkForm)),
      'Link saved',
    );
    if (ok) setLinkForm(null);
  };

  const makeMain = (link) => run(() => api.patch(`/warehouses/links/${link.id}`, { isPrimaryForChannel: true }), `${link.warehouseCode} is now the main ${link.channelName} warehouse`);

  const removeLink = async () => {
    const ok = await run(() => api.delete(`/warehouses/links/${removing.id}`), 'Link removed');
    if (ok) setRemoving(null);
  };

  const toggleChannel = (id) => setWhForm((form) => ({
    ...form,
    channels: form.channels.includes(id) ? form.channels.filter((c) => c !== id) : [...form.channels, id],
  }));

  const linkChoices = linkForm
    ? linkableWarehouses(data.warehouses, data.connections.filter((link) => link.id !== linkForm.id), linkForm.channel)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--color-border-premium))] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Backup: download every warehouse and channel link, to set them up the same way later.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" className={`w-[112px] ${STILL}`} disabled={Boolean(exporting)} onClick={() => download('csv')}>
            {exporting === 'csv' ? 'Preparing...' : 'Export CSV'}
          </Button>
          <Button size="sm" variant="outline" className={`w-[112px] ${STILL}`} disabled={Boolean(exporting)} onClick={() => download('json')}>
            {exporting === 'json' ? 'Preparing...' : 'Export JSON'}
          </Button>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><Warehouse className="h-5 w-5" /> Warehouses</h2>
            <p className="text-sm text-muted-foreground">Add as many as you need, rename them, set them Inactive, or delete ones made by mistake.</p>
          </div>
          <Button className={`shrink-0 ${STILL}`} onClick={() => { setBanner(''); setWhForm({ ...blankWarehouse }); }}>
            <Plus className="mr-1 h-4 w-4" /> Add warehouse
          </Button>
        </div>
        <div className="min-h-[120px] overflow-x-auto rounded-xl border border-[hsl(var(--color-border-premium))]">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-[hsl(var(--color-muted))] text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-28 px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="w-24 px-3 py-2">Type</th>
                <th className="w-24 px-3 py-2">Status</th>
                <th className="w-24 px-3 py-2">Channels</th>
                <th className="w-[168px] px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && <tr><td colSpan={6} className="h-24 px-3 text-center text-muted-foreground">Loading warehouses...</td></tr>}
              {loaded && data.warehouses.length === 0 && (
                <tr><td colSpan={6} className="h-24 px-3 text-center text-muted-foreground">No warehouses yet. Add one to start linking channels.</td></tr>
              )}
              {data.warehouses.map((wh) => (
                <tr key={wh.id} className="h-12 border-t border-[hsl(var(--color-border-premium))]">
                  <td className="px-3 font-medium">{wh.code}</td>
                  <td className="truncate px-3">{wh.name}</td>
                  <td className="px-3"><Badge variant={wh.type === 'virtual' ? 'secondary' : 'outline'}>{wh.type}</Badge></td>
                  <td className="px-3 capitalize">{wh.status}</td>
                  <td className="px-3">{linkCount(data.connections, wh.id)}</td>
                  <td className="px-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className={STILL} onClick={() => { setBanner(''); setWhForm({ ...blankWarehouse, ...wh, channels: [] }); }}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className={`${STILL} text-destructive`} onClick={() => setDeleting(wh)} aria-label={`Delete ${wh.code}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Link2 className="h-5 w-5" /> Channel ↔ warehouse links</h2>
          <p className="text-sm text-muted-foreground">
            Each channel sees stock only from the warehouses linked here. The main warehouse is used first. Put the channel&apos;s own location or warehouse id (for example Myntra C55185W28092) in the link.
          </p>
        </div>
        <div className="grid min-h-[160px] gap-3 md:grid-cols-2">
          {grouped.map((channel) => (
            <div key={channel.id} className="flex flex-col rounded-xl border border-[hsl(var(--color-border-premium))] p-3">
              <div className="mb-2 flex h-8 items-center justify-between gap-2">
                <p className="font-semibold">{channel.name} <span className="text-xs font-normal text-muted-foreground">· {channel.links.length} linked</span></p>
                <Button
                  size="sm"
                  variant="outline"
                  className={`shrink-0 ${STILL}`}
                  onClick={() => { setBanner(''); setLinkForm({ ...blankLink, channel: channel.id }); }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Link
                </Button>
              </div>
              {channel.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">No warehouse linked. {channel.name} shows no stock.</p>
              ) : (
                <ul className="space-y-1">
                  {channel.links.map((link) => (
                    <li key={link.id} className="flex h-10 items-center gap-2 rounded-lg bg-[hsl(var(--color-muted))]/50 px-2 text-sm">
                      <span className="w-16 shrink-0 font-medium">{link.warehouseCode}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={link.label}>{link.externalLocationId}</span>
                      <span className="w-[72px] shrink-0 text-right">
                        {link.isPrimaryForChannel
                          ? <Badge className="gap-1"><Star className="h-3 w-3" /> Main</Badge>
                          : <Button size="sm" variant="ghost" className={`h-7 px-2 ${STILL}`} onClick={() => makeMain(link)} disabled={saving}>Make main</Button>}
                      </span>
                      <Button size="sm" variant="ghost" className={`h-7 w-7 px-0 ${STILL}`} aria-label={`Edit ${link.channelName} ${link.warehouseCode}`} onClick={() => { setBanner(''); setLinkForm({ ...link }); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className={`h-7 w-7 px-0 text-destructive ${STILL}`} aria-label={`Remove ${link.channelName} ${link.warehouseCode}`} onClick={() => { setBanner(''); setRemoving(link); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold"><History className="h-5 w-5" /> Change history</h2>
          <p className="text-sm text-muted-foreground">Who added, changed or removed a warehouse or link, newest first (last 25).</p>
        </div>
        <div className="max-h-[320px] min-h-[96px] overflow-auto rounded-xl border border-[hsl(var(--color-border-premium))]">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-[hsl(var(--color-muted))] text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-40 px-3 py-2">When</th>
                <th className="w-36 px-3 py-2">Who</th>
                <th className="w-36 px-3 py-2">What</th>
                <th className="w-24 px-3 py-2">Channel</th>
                <th className="w-24 px-3 py-2">Warehouse</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={6} className="h-16 px-3 text-center text-muted-foreground">{loaded ? 'No changes yet.' : 'Loading...'}</td></tr>
              )}
              {history.map((row) => (
                <tr key={row.id} className="h-10 border-t border-[hsl(var(--color-border-premium))]">
                  <td className="px-3 text-xs text-muted-foreground">{historyTime(row.at)}</td>
                  <td className="truncate px-3" title={row.user}>{row.user}</td>
                  <td className="px-3">{row.action}</td>
                  <td className="px-3">{row.channel || '—'}</td>
                  <td className="px-3 font-medium">{row.warehouse || '—'}</td>
                  <td className="truncate px-3 text-xs text-muted-foreground" title={row.detail}>{row.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={Boolean(whForm)}
        onOpenChange={(next) => { if (!next) setWhForm(null); }}
        title={whForm?.id ? `Edit ${whForm.code}` : 'Add warehouse'}
        footer={(
          <>
            <Button variant="outline" className={STILL} onClick={() => setWhForm(null)}>Cancel</Button>
            <Button className={STILL} onClick={saveWarehouse} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </>
        )}
      >
        {whForm && (
          <div className="space-y-3">
            {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
            {!whForm.id && (
              <div>
                <label className="text-sm font-medium">Code</label>
                <Input value={whForm.code} onChange={(e) => setWhForm({ ...whForm, code: e.target.value })} placeholder="WH-003" />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} placeholder="Jaipur godown" />
            </div>
            {whForm.id ? (
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select value={whForm.status} onChange={(e) => setWhForm({ ...whForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (hidden from every channel, history kept)</option>
                </Select>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Type</label>
                  <Select value={whForm.type} onChange={(e) => setWhForm({ ...whForm, type: e.target.value, channels: e.target.value === 'virtual' ? whForm.channels.filter((c) => c === 'shopify') : whForm.channels })}>
                    <option value="physical">Physical (real stock, any channel)</option>
                    <option value="virtual">Virtual (Shopify-only stock)</option>
                  </Select>
                </div>
                <div>
                  <p className="text-sm font-medium">Sell on</p>
                  <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {channelsForType(data.channels, whForm.type).map((channel) => (
                      <label key={channel.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={whForm.channels.includes(channel.id)} onChange={() => toggleChannel(channel.id)} />
                        {channel.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">You can change these links any time below.</p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(linkForm)}
        onOpenChange={(next) => { if (!next) setLinkForm(null); }}
        title={linkForm?.id ? `Edit ${linkForm.channelName} link` : `Link a warehouse to ${data.channels.find((c) => c.id === linkForm?.channel)?.name || ''}`}
        footer={(
          <>
            <Button variant="outline" className={STILL} onClick={() => setLinkForm(null)}>Cancel</Button>
            <Button className={STILL} onClick={saveLink} disabled={saving || !linkForm?.warehouseId}>{saving ? 'Saving...' : 'Save link'}</Button>
          </>
        )}
      >
        {linkForm && (
          <div className="space-y-3">
            {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
            <div>
              <label className="text-sm font-medium">Warehouse</label>
              <Select value={linkForm.warehouseId} onChange={(e) => setLinkForm({ ...linkForm, warehouseId: e.target.value })}>
                <option value="">Choose a warehouse</option>
                {linkChoices.map((wh) => <option key={wh.id} value={wh.id}>{wh.code} · {wh.name}</option>)}
              </Select>
              {linkChoices.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Every active warehouse is already linked to this channel.</p>}
            </div>
            <div>
              <label className="text-sm font-medium">Channel location / warehouse id</label>
              <Input value={linkForm.externalLocationId} onChange={(e) => setLinkForm({ ...linkForm, externalLocationId: e.target.value })} placeholder="Leave empty if the channel has none" />
            </div>
            <div>
              <label className="text-sm font-medium">Label</label>
              <Input value={linkForm.label} onChange={(e) => setLinkForm({ ...linkForm, label: e.target.value })} placeholder="Myntra Delhi" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(linkForm.isPrimaryForChannel)} onChange={(e) => setLinkForm({ ...linkForm, isPrimaryForChannel: e.target.checked })} />
              Main warehouse for this channel
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(removing)}
        onOpenChange={(next) => { if (!next) setRemoving(null); }}
        title="Remove link"
        footer={(
          <>
            <Button variant="outline" className={STILL} onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" className={STILL} onClick={removeLink} disabled={saving}>{saving ? 'Removing...' : 'Remove link'}</Button>
          </>
        )}
      >
        {removing && (
          <div className="space-y-2 text-sm">
            {banner && <FormBanner tone="error" title="Could not remove">{banner}</FormBanner>}
            <p>{removing.channelName} will stop seeing stock from <b>{removing.warehouseCode}</b>. The warehouse and its stock stay.</p>
            {grouped.find((c) => c.id === removing.channel)?.links.length === 1 && (
              <FormBanner tone="warning" title={`${removing.channelName} will have no warehouse left`}>It shows no stock until you link another one.</FormBanner>
            )}
          </div>
        )}
      </Modal>

      <DeleteWarehouseDialog warehouse={deleting} onClose={() => setDeleting(null)} onDeleted={load} />
    </div>
  );
}
