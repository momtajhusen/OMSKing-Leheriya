import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { NOTIFICATION_EVENTS } from '../../constants/notificationEvents';
import api, { apiError } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Bell, Mail, MessageCircle, Send, Lock, Save, Settings2, CheckCircle2, KeyRound, Hash, Phone } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import { cn } from '../../lib/utils';

function withSaved(rows) {
  const byId = Object.fromEntries((rows || []).map((row) => [row.id, row]));
  return NOTIFICATION_EVENTS.map((notif) => ({
    ...notif,
    localSettings: {
      ...notif.channels,
      ...(byId[notif.id] ? {
        telegram: Boolean(byId[notif.id].telegram),
        email: Boolean(byId[notif.id].email),
        whatsapp: Boolean(byId[notif.id].whatsapp),
        other: Boolean(byId[notif.id].other),
      } : {}),
    },
  }));
}

export default function NotificationsPage() {
  const [notificationSettings, setNotificationSettings] = useState(() => withSaved([]));
  const [botToken, setBotToken] = useState('');
  const [ownerChatId, setOwnerChatId] = useState('');
  const [botConfigured, setBotConfigured] = useState(false);
  const [recent, setRecent] = useState([]);
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [mailConfigured, setMailConfigured] = useState(false);
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState('');
  const [whatsappToken, setWhatsappToken] = useState('');
  const [whatsappTo, setWhatsappTo] = useState('');
  const [whatsappConfigured, setWhatsappConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState('gmail');

  useEffect(() => {
    let live = true;
    api.get('/notifications').then(({ data }) => {
      if (!live) return;
      setNotificationSettings(withSaved(data.data?.events));
      setBotConfigured(Boolean(data.data?.botConfigured));
      setOwnerChatId(data.data?.ownerChatId || '');
      setRecent(data.data?.recent || []);
      setGmailUser(data.data?.gmailUser || '');
      setMailConfigured(Boolean(data.data?.mailConfigured));
      setWhatsappPhoneNumberId(data.data?.whatsappPhoneNumberId || '');
      setWhatsappTo(data.data?.whatsappTo || '');
      setWhatsappConfigured(Boolean(data.data?.whatsappConfigured));
      setLoaded(true);
    }).catch((err) => {
      if (live) toast.error(apiError(err, 'Could not load notification settings'));
    });
    return () => { live = false; };
  }, []);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/notifications', {
        botToken: botToken.trim(),
        ownerChatId: ownerChatId.trim(),
        gmailUser: gmailUser.trim(),
        gmailAppPassword: gmailAppPassword.trim(),
        whatsappPhoneNumberId: whatsappPhoneNumberId.trim(),
        whatsappToken: whatsappToken.trim(),
        whatsappTo: whatsappTo.trim(),
        events: Object.fromEntries(notificationSettings.map((notif) => [notif.id, notif.localSettings])),
      });
      setNotificationSettings(withSaved(data.data?.events));
      setBotConfigured(Boolean(data.data?.botConfigured));
      setOwnerChatId(data.data?.ownerChatId || '');
      setRecent(data.data?.recent || []);
      setBotToken('');
      setGmailUser(data.data?.gmailUser || '');
      setMailConfigured(Boolean(data.data?.mailConfigured));
      setGmailAppPassword('');
      setWhatsappPhoneNumberId(data.data?.whatsappPhoneNumberId || '');
      setWhatsappTo(data.data?.whatsappTo || '');
      setWhatsappConfigured(Boolean(data.data?.whatsappConfigured));
      setWhatsappToken('');
      toast.success('Notification settings saved');
      return true;
    } catch (err) {
      toast.error(apiError(err, 'Could not save notification settings'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openSetup = (tab) => {
    setSetupTab(tab);
    setSetupOpen(true);
  };

  const saveSetup = async () => {
    const ok = await handleSave();
    if (ok) setSetupOpen(false);
  };

  const channelIcons = {
    telegram: <Send className="w-4 h-4" />,
    email: <Mail className="w-4 h-4" />,
    whatsapp: <MessageCircle className="w-4 h-4" />,
    other: <Bell className="w-4 h-4" />,
  };

  const channelLabels = {
    telegram: 'Telegram',
    email: 'Email',
    whatsapp: 'WhatsApp',
    other: 'In app',
  };

  const channels = [
    {
      id: 'telegram',
      label: 'Telegram',
      icon: Send,
      ready: botConfigured,
      detail: ownerChatId ? `Company alerts go to ${ownerChatId}` : (botConfigured ? 'Add the chat that receives company alerts' : 'Add the bot from @BotFather'),
    },
    {
      id: 'gmail',
      label: 'Gmail',
      icon: Mail,
      ready: mailConfigured,
      detail: gmailUser || 'Add the company mailbox',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: MessageCircle,
      ready: whatsappConfigured,
      detail: whatsappTo || 'Add the number that receives alerts',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            <p className="mt-1 max-w-xl text-muted-foreground">
              Turn a switch on and save. That channel sends when the event happens: new order, vendor assign, dispatch, shipping, delivery, return, low stock, a failed job, or a vendor still waiting after 7 days.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openSetup('gmail')} disabled={!loaded}>
            <Settings2 className="mr-2 h-4 w-4" />
            Channel setup
          </Button>
          <Button onClick={handleSave} disabled={saving || !loaded}>
            <Save className="mr-2 h-4 w-4" />
            Save events
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {channels.map((channel) => {
          const Icon = channel.icon;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => openSetup(channel.id)}
              className="rounded-xl border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] p-5 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className={cn('rounded-xl p-2.5', channel.ready ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <Icon className="h-5 w-5" />
                </div>
                <Badge variant={channel.ready ? 'default' : 'outline'} className="gap-1">
                  {channel.ready && <CheckCircle2 className="h-3 w-3" />}
                  {channel.ready ? 'Ready' : 'Not set up'}
                </Badge>
              </div>
              <p className="mt-4 font-semibold">{channel.label}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{channel.detail}</p>
            </button>
          );
        })}
      </div>

      <Modal
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title="Channel setup"
        description="These belong to this company. Email arrives at the Gmail below. WhatsApp arrives on the number below."
        className="max-w-3xl"
        footer={(
          <>
            <Button variant="outline" onClick={() => setSetupOpen(false)}>Cancel</Button>
            <Button onClick={saveSetup} disabled={saving || !loaded}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save channel'}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex gap-1 sm:w-44 sm:flex-col sm:border-r sm:border-[hsl(var(--color-border-premium))] sm:pr-4">
            {channels.map((channel) => {
              const Icon = channel.icon;
              const active = setupTab === channel.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSetupTab(channel.id)}
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium sm:flex-none',
                    active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{channel.label}</span>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', channel.ready ? 'bg-primary' : 'bg-muted-foreground/40')} />
                </button>
              );
            })}
          </div>
          <div className="min-w-0 flex-1 space-y-4 sm:pl-2">
            {setupTab === 'telegram' && (
              <>
                <p className="text-sm text-muted-foreground">Company alerts go to the chat below when that event’s Telegram switch is on. Vendor Order still posts to the vendor’s own group.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="telegram-bot-token">Telegram bot token</label>
                  <Input
                    id="telegram-bot-token"
                    type="password"
                    autoComplete="new-password"
                    iconLeft={<KeyRound className="h-4 w-4" />}
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                    placeholder={botConfigured ? 'Token saved. Leave blank to keep it.' : 'From @BotFather'}
                  />
                  <p className="text-xs text-muted-foreground">Put each vendor’s group chat id on the vendor. The bot has to be a member of that group.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="telegram-owner-chat">Company alert chat id</label>
                  <Input
                    id="telegram-owner-chat"
                    iconLeft={<Hash className="h-4 w-4" />}
                    value={ownerChatId}
                    onChange={(event) => setOwnerChatId(event.target.value)}
                    placeholder="-100… or https://t.me/your_ops_group"
                  />
                </div>
              </>
            )}
            {setupTab === 'gmail' && (
              <>
                <p className="text-sm text-muted-foreground">Mail is sent from this Gmail and delivered to the same address. This is the same mailbox as Settings.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="notify-gmail">Gmail address</label>
                  <Input
                    id="notify-gmail"
                    type="email"
                    autoComplete="off"
                    iconLeft={<Mail className="h-4 w-4" />}
                    value={gmailUser}
                    onChange={(event) => setGmailUser(event.target.value)}
                    placeholder="mail@yourcompany.com"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="notify-gmail-pass">Gmail app password</label>
                  <Input
                    id="notify-gmail-pass"
                    type="password"
                    autoComplete="new-password"
                    iconLeft={<KeyRound className="h-4 w-4" />}
                    value={gmailAppPassword}
                    onChange={(event) => setGmailAppPassword(event.target.value)}
                    placeholder={mailConfigured ? 'Saved. Leave blank to keep it.' : 'Google app password'}
                  />
                </div>
              </>
            )}
            {setupTab === 'whatsapp' && (
              <>
                <p className="text-sm text-muted-foreground">WhatsApp Cloud API sends switched-on events to the number below.</p>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="notify-wa-id">Phone number ID</label>
                  <Input
                    id="notify-wa-id"
                    iconLeft={<Hash className="h-4 w-4" />}
                    value={whatsappPhoneNumberId}
                    onChange={(event) => setWhatsappPhoneNumberId(event.target.value)}
                    placeholder="From Meta WhatsApp Cloud API"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="notify-wa-token">Access token</label>
                  <Input
                    id="notify-wa-token"
                    type="password"
                    autoComplete="new-password"
                    iconLeft={<KeyRound className="h-4 w-4" />}
                    value={whatsappToken}
                    onChange={(event) => setWhatsappToken(event.target.value)}
                    placeholder={whatsappConfigured ? 'Token saved. Leave blank to keep it.' : 'Permanent token'}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="notify-wa-to">Number that receives alerts</label>
                  <Input
                    id="notify-wa-to"
                    iconLeft={<Phone className="h-4 w-4" />}
                    value={whatsappTo}
                    onChange={(event) => setWhatsappTo(event.target.value)}
                    placeholder="91XXXXXXXXXX"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* Notifications Table */}
      <Card>
        <CardHeader>
          <CardTitle>Event Notification Settings</CardTitle>
          <CardDescription>
            A switch sends only that channel. Email uses the company Gmail. WhatsApp uses the number in channel setup. Telegram uses the company chat, except Vendor Order which uses the vendor group. In app keeps the alert on this page. Owner assignment alerts stay on.
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
                <TableHead className="text-center">In app</TableHead>
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

      <Card>
        <CardHeader>
          <CardTitle>Recent alerts</CardTitle>
          <CardDescription>Each row is one send from a switch that was on when the event happened.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts yet. Save a switch, then the matching action writes a row here.</p>
          ) : (
            <div className="space-y-2">
              {recent.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--color-border-premium))] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{row.eventKey}</p>
                    {row.text && <p className="truncate text-xs text-muted-foreground">{row.text}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{row.channel}</Badge>
                    <Badge variant={row.status === 'sent' ? 'default' : 'secondary'}>{row.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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