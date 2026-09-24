import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import useChannelStore from '../../stores/channelStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Badge from '../ui/Badge';
import { Save, Plug, Unplug } from 'lucide-react';
import api, { apiError } from '../../lib/api';

export default function ChannelSetup({ showPlanNote = true }) {
  const catalog = useChannelStore((s) => s.catalog);
  const connections = useChannelStore((s) => s.connections);
  const hydrate = useChannelStore((s) => s.hydrateFromServer);
  const [drafts, setDrafts] = useState({});
  const [pick, setPick] = useState('');
  const [testing, setTesting] = useState('');

  const channel = catalog.find((c) => c.id === pick) || null;

  useEffect(() => {
    api.get('/channels').then(({ data }) => {
      hydrate(data.data || []);
    }).catch(() => {});
  }, [hydrate]);

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
      const credentials = credsFor(ch);
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
  const badge = conn?.status === 'connected'
    ? 'outline'
    : conn?.status === 'error'
      ? 'destructive'
      : 'secondary';

  return (
    <div className="space-y-6">
      {showPlanNote && (
        <p className="text-sm text-muted-foreground">
          Choose one channel. Only that channel’s API form is shown. Launch live: Shopify, Amazon, Myntra.
        </p>
      )}

      <div>
        <h3 className="font-medium mb-3">Select channel</h3>
        <div className="max-w-sm">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select channel</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <h3 className="font-medium mb-3">API config</h3>
        {!channel ? (
          <p className="text-sm text-muted-foreground">Select a channel above to see its form.</p>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Plug className="w-4 h-4" />
                    {channel.name}
                  </CardTitle>
                  <CardDescription>{channel.description}</CardDescription>
                  {conn?.lastTestMessage && (
                    <p className={`text-xs mt-2 ${conn.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {conn.lastTestMessage}
                    </p>
                  )}
                </div>
                <Badge variant={badge}>{conn?.status || 'not_configured'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {channel.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium mb-1">{field.label}</label>
                    <Input
                      type={field.type}
                      placeholder={field.placeholder}
                      value={values[field.key] || ''}
                      onChange={(e) => setField(channel.id, field.key, e.target.value)}
                    />
                    {field.hint && <p className="text-xs text-muted-foreground mt-1">{field.hint}</p>}
                  </div>
                ))}
              </div>
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
