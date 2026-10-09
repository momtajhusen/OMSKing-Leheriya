import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import useChannelStore from '../../stores/channelStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { Save, Plug, Unplug, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import api, { apiError } from '../../lib/api';

const STATUS = {
  connected: {
    label: 'Connected',
    pill: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  saved: {
    label: 'Saved',
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  error: {
    label: 'Failed',
    pill: 'bg-destructive/15 text-destructive',
  },
  not_configured: {
    label: 'Not set up',
    pill: 'bg-[hsl(var(--color-muted))] text-muted-foreground',
  },
};

const STATUS_ORDER = ['connected', 'saved', 'error', 'not_configured'];

function connectionState(conn, modeOverride) {
  const mode = modeOverride || conn?.credentials?.apiMode || 'live';
  const tested = conn?.lastTestMode || '';
  const environmentMatches = !tested || tested === mode;
  if ((conn?.status === 'connected' || conn?.lastTestOk) && environmentMatches) return 'connected';
  if (conn?.status === 'error' && environmentMatches) return 'error';
  if (conn?.status === 'saved' || conn?.lastTestOk || conn?.status === 'error' || conn?.status === 'connected') return 'saved';
  return 'not_configured';
}

function tabsInStatusOrder(catalog, connections) {
  return catalog
    .map((item, index) => ({ item, index, state: connectionState(connections[item.id]) }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.state) - STATUS_ORDER.indexOf(b.state) || a.index - b.index)
    .map((row) => row.item);
}

function FieldGrid({ title, fields, values, savedSecrets, onChange }) {
  if (!fields.length) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map((field) => {
          const kept = field.type === 'password' && savedSecrets.has(field.key) && !String(values[field.key] || '').trim();
          return (
            <div key={field.key}>
              <label className="block text-sm font-medium mb-1" htmlFor={`${field.key}-input`}>
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </label>
              {field.type === 'select' ? (
                <Select
                  id={`${field.key}-input`}
                  value={values[field.key] || 'live'}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="rounded-lg border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] text-foreground"
                >
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={`${field.key}-input`}
                  type={field.type}
                  required={Boolean(field.required) && !kept}
                  placeholder={kept ? 'Saved. Leave blank to keep it.' : field.placeholder}
                  value={values[field.key] || ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                />
              )}
              {field.hint && <p className="text-xs text-muted-foreground mt-1">{field.hint}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ChannelSetup({ showPlanNote = true }) {
  const catalog = useChannelStore((s) => s.catalog);
  const connections = useChannelStore((s) => s.connections);
  const hydrate = useChannelStore((s) => s.hydrateFromServer);
  const [drafts, setDrafts] = useState({});
  const [pick, setPick] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState('');
  const userPicked = useRef(false);

  const channel = catalog.find((c) => c.id === pick) || null;

  useEffect(() => {
    let cancelled = false;
    api.get('/channels').then(({ data }) => {
      if (!cancelled) hydrate(data.data || []);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [hydrate]);

  useEffect(() => {
    if (!loaded || userPicked.current || pick || !catalog.length) return;
    const connected = catalog.find((item) => connectionState(connections[item.id]) === 'connected');
    setPick((connected || catalog[0]).id);
  }, [loaded, catalog, connections, pick]);

  const choose = (id) => {
    userPicked.current = true;
    setPick(id);
  };

  const credsFor = (ch) =>
    drafts[ch.id] || connections[ch.id]?.credentials || {};

  const setField = (channelId, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [channelId]: {
        ...(prev[channelId] || connections[channelId]?.credentials || {}),
        [key]: value,
      },
    }));
  };

  const save = async (ch, { quiet } = {}) => {
    try {
      const credentials = { ...credsFor(ch) };
      if (!String(credentials.apiMode || '').trim()) credentials.apiMode = 'live';
      const savedSecrets = new Set(connections[ch.id]?.savedSecretKeys || []);
      const missing = ch.fields.filter((field) => {
        if (!field.required) return false;
        if (String(credentials[field.key] || '').trim()) return false;
        return !(field.type === 'password' && savedSecrets.has(field.key));
      });
      if (missing.length) {
        toast.error(`${missing.map((field) => field.label).join(', ')} required`);
        return false;
      }
      const { data } = await api.patch(`/channels/${ch.id}`, {
        credentials,
        warehouseCode: credentials.warehouseCode || credentials.storeId || '',
        importOrdersFrom: credentials.importOrdersFrom || undefined,
      });
      hydrate([data.data]);
      if (!quiet) toast.success(`${ch.name} saved (encrypted)`);
      return true;
    } catch (err) {
      toast.error(apiError(err, 'Could not save channel'));
      return false;
    }
  };

  const test = async (ch) => {
    setTesting(ch.id);
    try {
      const saved = await save(ch, { quiet: true });
      if (!saved) return;
      const { data } = await api.post(`/channels/${ch.id}/test`);
      hydrate([data.data]);
      if (data.data?.ok) toast.success(data.message || 'Connected');
      else if (data.data?.incomplete) toast(data.message || 'Saved. Extra keys needed for live ping.');
      else toast.error(data.message || 'Test failed');
    } catch (err) {
      toast.error(apiError(err, 'Test failed'));
    } finally {
      setTesting('');
    }
  };

  const conn = channel ? connections[channel.id] : null;
  const values = channel ? credsFor(channel) : {};
  const savedSecrets = new Set(conn?.savedSecretKeys || []);
  const requiredFields = channel ? channel.fields.filter((field) => field.required) : [];
  const optionalFields = channel ? channel.fields.filter((field) => !field.required) : [];
  const selectedMode = values.apiMode || conn?.credentials?.apiMode || 'live';
  const state = connectionState(conn, selectedMode);
  const status = STATUS[state];

  return (
    <div className="space-y-6">
      {showPlanNote && (
        <p className="text-sm text-muted-foreground">
          Open a channel tab. A green tick means that channel is connected.
        </p>
      )}

      <div role="tablist" aria-label="Channels" className="flex flex-wrap gap-2">
        {tabsInStatusOrder(catalog, connections).map((item) => {
          const itemMode = item.id === channel?.id
            ? selectedMode
            : (connections[item.id]?.credentials?.apiMode || 'live');
          const itemState = connectionState(connections[item.id], itemMode);
          const itemStatus = STATUS[itemState];
          const active = item.id === pick;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => choose(item.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all',
                'bg-[hsl(var(--color-card-bg))]',
                active
                  ? 'border-[hsl(var(--color-primary-blue))] shadow-sm ring-2 ring-[hsl(var(--color-primary-blue))]/20'
                  : 'border-[hsl(var(--color-border-premium))] hover:border-[hsl(var(--color-primary-blue))]/40',
              )}
            >
              {itemState === 'connected' && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
              )}
              <span className="text-sm font-medium">{item.name}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', itemStatus.pill)}>
                {itemStatus.label}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        {!channel ? (
          <p className="text-sm text-muted-foreground">Open a channel tab to see its form.</p>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {state === 'connected'
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : <Plug className="w-4 h-4" />}
                    {channel.name}
                  </CardTitle>
                  <CardDescription>{channel.description}</CardDescription>
                  {conn?.lastTestMessage && (
                    <p className={`text-xs mt-2 ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {conn.lastTestMessage}
                    </p>
                  )}
                </div>
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', status.pill)}>
                  {state === 'connected' && <CheckCircle2 className="h-4 w-4" />}
                  {status.label}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <FieldGrid
                title="Required"
                fields={requiredFields}
                values={values}
                savedSecrets={savedSecrets}
                onChange={(key, value) => setField(channel.id, key, value)}
              />
              {optionalFields.length > 0 && (
                <FieldGrid
                  title="Optional"
                  fields={optionalFields}
                  values={values}
                  savedSecrets={savedSecrets}
                  onChange={(key, value) => setField(channel.id, key, value)}
                />
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => save(channel)}>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </Button>
                <Button size="sm" variant="outline" disabled={testing === channel.id} onClick={() => test(channel)}>
                  <Unplug className="w-4 h-4 mr-2" />
                  {testing === channel.id ? 'Testing…' : 'Test connection'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
