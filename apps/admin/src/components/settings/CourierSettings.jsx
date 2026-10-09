import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { KeyRound, Plane, Plus, Search, Truck } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/Table';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Modal from '../ui/Modal';
import { FormBanner } from '../ui/FormBanner';
import api, { apiError } from '../../lib/api';

const CAP_LABEL = { forward: 'Forward', return: 'Return', ndr: 'NDR' };

function initials(name) {
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function CourierMark({ name }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
      {initials(name)}
    </span>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-[hsl(var(--color-border-premium))] text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }) {
  const active = status === 'active';
  return (
    <Badge variant={active ? 'outline' : 'secondary'} className={active ? 'border-emerald-500/40 text-emerald-700' : ''}>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}

function ModeCell({ mode }) {
  const air = mode === 'air';
  const Icon = air ? Plane : Truck;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      {air ? 'Air' : 'Surface'}
    </span>
  );
}

function emptyCreds(fields) {
  return Object.fromEntries((fields || []).map((field) => [field.key, '']));
}

export default function CourierSettings() {
  const [catalog, setCatalog] = useState({ platform: [], own: [], customFields: [] });
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lane, setLane] = useState('platform');
  const [query, setQuery] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [capFilter, setCapFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [banner, setBanner] = useState('');

  const load = async () => {
    const { data } = await api.get('/settings/couriers');
    const payload = data.data || {};
    setCatalog({
      platform: payload.platform || [],
      own: payload.own || [],
      customFields: payload.customFields || [],
    });
    setAccounts(payload.accounts || []);
  };

  useEffect(() => {
    load()
      .catch((err) => toast.error(apiError(err, 'Could not load couriers')))
      .finally(() => setLoading(false));
  }, []);

  const accountFor = (source, code) => accounts.find((row) => row.source === source && row.code === code);

  const platformRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.platform
      .map((item) => {
        const account = accountFor('platform', item.code);
        return {
          item,
          account,
          status: account?.status || item.defaultStatus || 'inactive',
          priority: account?.priority ?? item.priority,
          rateHalfKg: account?.rateHalfKg ?? item.rateHalfKg,
          serviceability: account?.serviceability || item.serviceability,
          mode: account?.mode || item.mode,
          weightLabel: account?.weightLabel || item.weightLabel,
        };
      })
      .filter((row) => (modeFilter === 'all' ? true : row.mode === modeFilter))
      .filter((row) => (statusFilter === 'all' ? true : row.status === statusFilter))
      .filter((row) => !q || row.item.name.toLowerCase().includes(q))
      .sort((a, b) => a.priority - b.priority || a.item.name.localeCompare(b.item.name));
  }, [catalog.platform, accounts, query, modeFilter, statusFilter]);

  const platformCounts = useMemo(() => {
    const rows = catalog.platform.map((item) => accountFor('platform', item.code)?.status || item.defaultStatus || 'inactive');
    return {
      all: rows.length,
      active: rows.filter((status) => status === 'active').length,
      inactive: rows.filter((status) => status !== 'active').length,
    };
  }, [catalog.platform, accounts]);

  const ownConnected = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((row) => row.source === 'own')
      .filter((row) => (capFilter === 'all' ? true : (row.capabilities || []).includes(capFilter)))
      .filter((row) => !q || row.name.toLowerCase().includes(q));
  }, [accounts, query, capFilter]);

  const ownAvailable = useMemo(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set(accounts.filter((row) => row.source === 'own').map((row) => row.code));
    return catalog.own
      .filter((item) => !taken.has(item.code))
      .filter((item) => (capFilter === 'all' ? true : item.capabilities.includes(capFilter)))
      .filter((item) => !q || item.name.toLowerCase().includes(q));
  }, [catalog.own, accounts, query, capFilter]);

  const closeDialog = () => {
    setDialog(null);
    setBanner('');
  };

  const saveStatus = async (row, status) => {
    setBusy(row.item.code);
    try {
      if (row.account) {
        await api.patch(`/settings/couriers/${row.account.id}`, { status });
      } else {
        await api.post('/settings/couriers', { source: 'platform', code: row.item.code, status });
      }
      await load();
      toast.success(status === 'active' ? `${row.item.name} activated` : `${row.item.name} paused`);
    } catch (err) {
      toast.error(apiError(err, 'Could not update courier'));
    } finally {
      setBusy('');
    }
  };

  const openRates = (row) => {
    setBanner('');
    setForm({
      priority: row.priority,
      rateHalfKg: row.rateHalfKg,
      serviceability: row.serviceability,
      status: row.status,
    });
    setDialog({ type: 'rates', row });
  };

  const saveRates = async () => {
    const row = dialog?.row;
    if (!row) return;
    setBusy('dialog');
    setBanner('');
    const payload = {
      priority: Number(form.priority),
      rateHalfKg: Number(form.rateHalfKg),
      serviceability: form.serviceability,
      status: form.status,
    };
    try {
      if (row.account) await api.patch(`/settings/couriers/${row.account.id}`, payload);
      else await api.post('/settings/couriers', { source: 'platform', code: row.item.code, ...payload });
      await load();
      toast.success(`${row.item.name} saved`);
      closeDialog();
    } catch (err) {
      setBanner(apiError(err, 'Could not save courier'));
    } finally {
      setBusy('');
    }
  };

  const openCredentials = (item, account) => {
    setBanner('');
    const fields = item?.fields || catalog.customFields;
    const creds = emptyCreds(fields);
    if (account?.credentials) {
      Object.keys(creds).forEach((key) => {
        if (account.credentials[key]) creds[key] = account.credentials[key];
      });
    }
    setForm({
      name: account?.name || item?.name || '',
      mode: account?.mode || 'surface',
      capabilities: account?.capabilities?.length ? [...account.capabilities] : [...(item?.capabilities || ['forward'])],
      credentials: creds,
    });
    setDialog({ type: 'credentials', item, account });
  };

  const openCustom = () => openCredentials(null, null);

  const toggleCap = (cap) => {
    setForm((prev) => {
      const has = (prev.capabilities || []).includes(cap);
      const capabilities = has
        ? prev.capabilities.filter((item) => item !== cap)
        : [...(prev.capabilities || []), cap];
      return { ...prev, capabilities: capabilities.length ? capabilities : ['forward'] };
    });
  };

  const saveCredentials = async () => {
    setBusy('dialog');
    setBanner('');
    const item = dialog?.item;
    const account = dialog?.account;
    const payload = {
      source: 'own',
      code: item?.code || 'custom',
      name: form.name,
      mode: form.mode,
      capabilities: form.capabilities,
      credentials: form.credentials,
      status: 'active',
    };
    try {
      if (account) await api.patch(`/settings/couriers/${account.id}`, payload);
      else await api.post('/settings/couriers', payload);
      await load();
      toast.success(account ? 'Courier credentials updated' : 'Courier connected');
      closeDialog();
    } catch (err) {
      setBanner(apiError(err, 'Could not save credentials'));
    } finally {
      setBusy('');
    }
  };

  const removeOwn = async () => {
    const account = dialog?.account;
    if (!account) return;
    setBusy('dialog');
    setBanner('');
    try {
      await api.delete(`/settings/couriers/${account.id}`);
      await load();
      toast.success('Courier removed');
      closeDialog();
    } catch (err) {
      setBanner(apiError(err, 'Could not remove courier'));
    } finally {
      setBusy('');
    }
  };

  const credFields = dialog?.type === 'credentials'
    ? (dialog.item?.fields || catalog.customFields)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold mb-1">Courier Settings</h2>
          <p className="text-sm text-muted-foreground">
            Use an OMSKing courier, or connect this store’s own courier account.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setLane('platform'); setQuery(''); }} className={`pill-tab ${lane === 'platform' ? 'pill-tab-active' : 'pill-tab-inactive'}`}>
          <Truck className="h-4 w-4" />
          Manage Courier
        </button>
        <button type="button" onClick={() => { setLane('own'); setQuery(''); }} className={`pill-tab ${lane === 'own' ? 'pill-tab-active' : 'pill-tab-inactive'}`}>
          <KeyRound className="h-4 w-4" />
          Manage Own Courier
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading couriers…</p>
      ) : lane === 'platform' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            For stores shipping on OMSKing accounts. Activate a partner. You do not paste API keys here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by courier name" className="pl-9" />
            </div>
            <div className="w-40">
              <Select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
                <option value="all">All modes</option>
                <option value="air">Air</option>
                <option value="surface">Surface</option>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All ({platformCounts.all})</Chip>
              <Chip active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Active ({platformCounts.active})</Chip>
              <Chip active={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')}>Inactive ({platformCounts.inactive})</Chip>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Rate (0.5kg)</TableHead>
                <TableHead>Serviceability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {platformRows.map((row) => (
                <TableRow key={row.item.code}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <CourierMark name={row.item.name} />
                      <span className="font-medium">{row.item.name}</span>
                    </div>
                  </TableCell>
                  <TableCell><ModeCell mode={row.mode} /></TableCell>
                  <TableCell>{row.weightLabel}</TableCell>
                  <TableCell>₹{row.rateHalfKg}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.serviceability}</TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {row.status === 'active' ? (
                        <Button size="sm" variant="outline" loading={busy === row.item.code} onClick={() => saveStatus(row, 'inactive')}>
                          Pause
                        </Button>
                      ) : (
                        <Button size="sm" loading={busy === row.item.code} onClick={() => saveStatus(row, 'active')}>
                          Activate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openRates(row)}>Edit</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!platformRows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No couriers match this filter.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            For stores that already have their own Delhivery, Bluedart, or other courier account. Add that account’s API credentials. Keys are encrypted for this tenant.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by courier name" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={capFilter === 'all'} onClick={() => setCapFilter('all')}>All</Chip>
              <Chip active={capFilter === 'forward'} onClick={() => setCapFilter('forward')}>Forward</Chip>
              <Chip active={capFilter === 'return'} onClick={() => setCapFilter('return')}>Return</Chip>
              <Chip active={capFilter === 'ndr'} onClick={() => setCapFilter('ndr')}>NDR</Chip>
            </div>
            <Button size="sm" onClick={openCustom}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add courier
            </Button>
          </div>

          <div>
            <h3 className="mb-3 font-medium">Integrated couriers ({ownConnected.length})</h3>
            {ownConnected.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Courier</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Credentials</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownConnected.map((account) => {
                    const known = catalog.own.find((item) => item.code === account.code);
                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <CourierMark name={account.name} />
                            <span className="font-medium">{account.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(account.capabilities || []).map((cap) => (
                              <Badge key={cap} variant="outline">{CAP_LABEL[cap] || cap}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {account.hasSecrets ? 'Saved and encrypted' : 'Missing API key'}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => openCredentials(known || null, account)}>
                            Update credentials
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No own courier is connected yet.</p>
            )}
          </div>

          <div>
            <h3 className="mb-3 font-medium">Direct courier integration ({ownAvailable.length})</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Courier</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Integration details</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ownAvailable.map((item) => (
                  <TableRow key={item.code}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <CourierMark name={item.name} />
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.capabilities.map((cap) => (
                          <Badge key={cap} variant="outline">{CAP_LABEL[cap] || cap}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">{item.blurb}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => openCredentials(item, null)}>Add credentials</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!ownAvailable.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">No couriers match this filter.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Modal
        open={dialog?.type === 'rates'}
        onOpenChange={(open) => { if (!open) closeDialog(); }}
        title={dialog?.row ? `Edit ${dialog.row.item.name}` : 'Edit courier'}
        description="Priority, rate, and where this partner delivers. This does not ask for an API key."
        footer={(
          <>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button loading={busy === 'dialog'} onClick={saveRates}>Save</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <Select value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <Input type="number" min="1" value={form.priority ?? ''} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Rate (0.5kg)</label>
              <Input type="number" min="0" value={form.rateHalfKg ?? ''} onChange={(e) => setForm({ ...form, rateHalfKg: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Serviceability</label>
            <Input value={form.serviceability || ''} onChange={(e) => setForm({ ...form, serviceability: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal
        open={dialog?.type === 'credentials'}
        onOpenChange={(open) => { if (!open) closeDialog(); }}
        className="max-w-xl"
        title={dialog?.account ? `Update ${dialog.account.name}` : dialog?.item ? `Add ${dialog.item.name} credentials` : 'Add courier'}
        description={dialog?.item?.blurb || 'Connect a courier that is not in the list. The API token is stored encrypted.'}
        footer={(
          <>
            {dialog?.account && (
              <Button variant="outline" className="mr-auto" loading={busy === 'dialog'} onClick={removeOwn}>Remove</Button>
            )}
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button loading={busy === 'dialog'} onClick={saveCredentials}>Save credentials</Button>
          </>
        )}
      >
        <div className="space-y-3">
          {banner && <FormBanner tone="error" title="Could not save">{banner}</FormBanner>}
          {!dialog?.item && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">Courier name</label>
                <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Courier name" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Mode</label>
                <Select value={form.mode || 'surface'} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option value="surface">Surface</option>
                  <option value="air">Air</option>
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium">Capabilities</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(CAP_LABEL).map(([cap, label]) => (
                    <Chip key={cap} active={(form.capabilities || []).includes(cap)} onClick={() => toggleCap(cap)}>{label}</Chip>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {credFields.map((field) => (
              <div key={field.key} className={field.type === 'password' ? '' : ''}>
                <label className="mb-1 block text-sm font-medium">{field.label}</label>
                <Input
                  type={field.type === 'password' ? 'password' : 'text'}
                  placeholder={dialog?.account && field.type === 'password' ? 'Leave blank to keep the saved key' : field.placeholder}
                  value={form.credentials?.[field.key] || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      credentials: { ...(prev.credentials || {}), [field.key]: value },
                    }));
                  }}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
