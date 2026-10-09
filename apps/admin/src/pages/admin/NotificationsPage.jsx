import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { NOTIFICATION_EVENTS } from '../../constants/notificationEvents';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Bell, Mail, MessageSquare, Send, Lock, Save } from 'lucide-react';

const STORAGE_KEY = 'omsking-notification-prefs';

export default function NotificationsPage() {
  const [notificationSettings, setNotificationSettings] = useState(() => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { saved = {}; }
    return NOTIFICATION_EVENTS.map((notif) => ({ ...notif, localSettings: { ...notif.channels, ...saved[notif.id] } }));
  });

  const handleToggle = (notifId, channel) => {
    setNotificationSettings(prev =>
      prev.map(notif =>
        notif.id === notifId && !notif.isOwnerAlert
          ? {
              ...notif,
              localSettings: {
                ...notif.localSettings,
                [channel]: !notif.localSettings[channel]
              }
            }
          : notif
      )
    );
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(notificationSettings.map((notif) => [notif.id, notif.localSettings]))));
    toast.success('Preferences saved in this browser');
  };

  const channelIcons = {
    telegram: <MessageSquare className="w-4 h-4" />,
    email: <Mail className="w-4 h-4" />,
    whatsapp: <Send className="w-4 h-4" />,
    other: <Bell className="w-4 h-4" />,
  };

  const channelLabels = {
    telegram: 'Telegram',
    email: 'Email',
    whatsapp: 'WhatsApp',
    other: 'Other',
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Notifications</h1>
          <p className="text-muted-foreground">Telegram, email, WhatsApp per event. Vendor WhatsApp if an assigned order is not dispatched in 7 days.</p>
        </div>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" />
          Save Settings
        </Button>
      </div>

      {/* Info Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Bell className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Sending is not connected yet</p>
              <p className="text-sm text-muted-foreground">
                Choose which events should notify on which channel. These choices are saved in this browser; no Telegram, email or WhatsApp message is sent until a provider is connected.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications Table */}
      <Card>
        <CardHeader>
          <CardTitle>Event Notification Settings</CardTitle>
          <CardDescription>
            Toggle notifications for each event type and channel. Owner alerts are always enabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Telegram</TableHead>
                <TableHead className="text-center">Email</TableHead>
                <TableHead className="text-center">WhatsApp</TableHead>
                <TableHead className="text-center">Other</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notificationSettings.map((notif) => (
                <TableRow key={notif.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {notif.isOwnerAlert && <Lock className="w-4 h-4 text-muted-foreground" />}
                      {notif.event}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {notif.description}
                  </TableCell>
                  {['telegram', 'email', 'whatsapp', 'other'].map((channel) => (
                    <TableCell key={channel} className="text-center">
                      <button
                        onClick={() => handleToggle(notif.id, channel)}
                        disabled={notif.isOwnerAlert}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          notif.localSettings[channel] ? 'bg-primary' : 'bg-input'
                        } ${notif.isOwnerAlert ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            notif.localSettings[channel] ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </TableCell>
                  ))}
                  <TableCell className="text-center">
                    {notif.isOwnerAlert ? (
                      <Badge variant="outline" className="gap-1">
                        <Lock className="w-3 h-3" />
                        Always On
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        Configurable
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Channel Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {['telegram', 'email', 'whatsapp', 'other'].map((channel) => {
          const enabledCount = notificationSettings.filter(
            notif => notif.localSettings[channel]
          ).length;
          const totalCount = notificationSettings.length;
          
          return (
            <Card key={channel}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    {channelIcons[channel]}
                  </div>
                  <div>
                    <p className="font-medium">{channelLabels[channel]}</p>
                    <p className="text-sm text-muted-foreground">
                      {enabledCount}/{totalCount} events enabled
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Legend */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-6 h-3 bg-primary rounded-full" />
              <span className="text-muted-foreground">Enabled</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-3 bg-input rounded-full" />
              <span className="text-muted-foreground">Disabled</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Owner Alert (Always On)</span>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}