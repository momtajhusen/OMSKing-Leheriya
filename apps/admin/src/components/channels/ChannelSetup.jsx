import { useState } from 'react';
import { toast } from 'react-hot-toast';
import useChannelStore from '../../stores/channelStore';
import { SUBSCRIPTION_PLANS } from '../../mocks/channels';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Badge from '../ui/Badge';
import { Save, Plug, X } from 'lucide-react';

export default function ChannelSetup({ showPlanNote = true }) {
  const catalog = useChannelStore((s) => s.catalog);
  const enabledIds = useChannelStore((s) => s.enabledIds);
  const connections = useChannelStore((s) => s.connections);
  const planId = useChannelStore((s) => s.planId);
  const addChannel = useChannelStore((s) => s.addChannel);
  const removeChannel = useChannelStore((s) => s.removeChannel);
  const saveCredentials = useChannelStore((s) => s.saveCredentials);
  const [drafts, setDrafts] = useState({});
  const [pick, setPick] = useState('');

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
  const overLimit = plan?.channelLimit && enabledIds.length > plan.channelLimit;
  const available = catalog.filter((c) => !enabledIds.includes(c.id));

  const credsFor = (channel) =>
    drafts[channel.id] || connections[channel.id]?.credentials || {};

  const setField = (channelId, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [channelId]: {
        ...(prev[channelId] || connections[channelId]?.credentials || {}),
        [key]: value,
      },
    }));
  };

  const onSelect = (id) => {
    setPick('');
    if (!id) return;
    addChannel(id);
  };

  const save = (channel) => {
    saveCredentials(channel.id, credsFor(channel));
    toast.success(`${channel.name} API saved`);
  };

  return (
    <div className="space-y-6">
      {showPlanNote && (
        <p className="text-sm text-muted-foreground">
          This merchant is on <span className="font-medium text-foreground">{plan?.name}</span>
          {plan?.channelLimit
            ? ` (${plan.channelLimit} channel${plan.channelLimit === 1 ? '' : 's'} included).`
            : ' (unlimited channels).'}{' '}
          Choose a channel from the list, then fill that channel&apos;s API. Launch set is Shopify, Amazon, Myntra.
        </p>
      )}

      {overLimit && (
        <p className="text-sm text-destructive">
          This plan allows {plan.channelLimit} channels. Upgrade the subscription to keep extra
          channels enabled.
        </p>
      )}

      <div>
        <h3 className="font-medium mb-3">Select channel</h3>
        <div className="max-w-sm">
          <Select value={pick} onChange={(e) => onSelect(e.target.value)}>
            <option value="">Select channel</option>
            {available.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </Select>
        </div>
        {available.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">All current channel options are added.</p>
        )}
      </div>

      <div>
        <h3 className="font-medium mb-3">API config</h3>
        {enabledIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Select a channel above to configure its API.</p>
        ) : (
          <div className="space-y-4">
            {catalog
              .filter((c) => enabledIds.includes(c.id))
              .map((channel) => {
                const conn = connections[channel.id];
                const values = credsFor(channel);
                return (
                  <Card key={channel.id}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Plug className="w-4 h-4" />
                            {channel.name}
                          </CardTitle>
                          <CardDescription>{channel.description}</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={conn?.status === 'Connected' ? 'outline' : 'secondary'}>
                            {conn?.status || 'Not configured'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeChannel(channel.id)}
                            aria-label={`Remove ${channel.name}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
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
                          </div>
                        ))}
                      </div>
                      <Button size="sm" onClick={() => save(channel)}>
                        <Save className="w-4 h-4 mr-2" />
                        Save {channel.name} API
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
