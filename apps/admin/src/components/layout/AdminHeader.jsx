import { useEffect, useMemo, useState } from 'react';
import {
  Menu,
  Bell,
  Sun,
  Moon,
  Search,
  PackageCheck,
  Store,
  AlertTriangle,
  FileSpreadsheet,
  ShoppingCart,
  Settings,
  LogOut,
  ChevronDown,
  Users,
  FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { relativeTime } from '../../lib/orderMetrics';
import { cn } from '../../lib/utils';
import useThemeStore from '../../stores/themeStore';
import useUIStore from '../../stores/uiStore';
import { useAuth } from '../../hooks/useAuth';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import Breadcrumbs from '../ui/Breadcrumbs';
import Button from '../ui/Button';

import { ROLE_LABELS } from '../../constants/roles';
import { usePermissions } from '../../hooks/usePermissions';
import BrandLogo from '../brand/BrandLogo';
import { ProfileAvatar, useProfilePhoto } from '../account/ProfilePhoto';
import { Camera } from 'lucide-react';

const NOTIFICATION_ICONS = {
  shipping: PackageCheck,
  vendor: Store,
  inventory: AlertTriangle,
  alert: AlertTriangle,
  invoice: FileSpreadsheet,
  order: ShoppingCart,
};

const NOTIFICATION_TONES = {
  shipping: 'bg-emerald-500/15 text-emerald-400',
  vendor: 'bg-violet-500/15 text-violet-400',
  inventory: 'bg-amber-500/15 text-amber-400',
  alert: 'bg-rose-500/15 text-rose-400',
  invoice: 'bg-emerald-500/15 text-emerald-400',
  order: 'bg-sky-500/15 text-sky-400',
};

const IN_APP_TITLES = {
  'NOT-001': 'New order',
  'NOT-002': 'Vendor order',
  'NOT-003': 'Dispatched',
  'NOT-004': 'Shipping update',
  'NOT-005': 'Delivered',
  'NOT-006': 'Return',
  'NOT-007': 'Low stock',
  'NOT-008': 'Job failed',
  'NOT-009': 'Vendor assigned',
  'NOT-010': 'Dispatch overdue',
};

const IN_APP_TYPES = {
  'NOT-001': 'order',
  'NOT-002': 'vendor',
  'NOT-003': 'shipping',
  'NOT-004': 'shipping',
  'NOT-005': 'shipping',
  'NOT-006': 'alert',
  'NOT-007': 'inventory',
  'NOT-008': 'alert',
  'NOT-009': 'vendor',
  'NOT-010': 'shipping',
};

function AdminHeader() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeStore();
  const { toggleSidebar, breadcrumbs, mobileOpen, setMobileOpen, activeRole } = useUIStore();
  const { logout, user, effectiveRole } = useAuth();
  const { canOpenPath } = usePermissions();
  const [events, setEvents] = useState([]);
  const [readIds, setReadIds] = useState(() => new Set());

  useEffect(() => {
    if (!user || user.role === 'vendor') return undefined;
    let alive = true;
    api.get('/notifications').then(({ data }) => {
      if (!alive) return;
      const rows = (data.data?.recent || []).filter((row) => row.channel === 'in_app' && row.status === 'sent');
      setEvents(rows.map((row) => ({
        id: `note-${row.id}`,
        title: IN_APP_TITLES[row.eventKey] || row.eventKey,
        detail: row.text || '',
        at: row.at,
        type: IN_APP_TYPES[row.eventKey] || 'alert',
        href: '/notifications',
      })));
    }).catch(() => {
      if (alive) setEvents([]);
    });
    return () => { alive = false; };
  }, [user]);

  const inbox = useMemo(() => events.map((item) => ({
    ...item,
    time: item.at ? relativeTime(item.at) : '',
    unread: !readIds.has(item.id),
  })), [events, readIds]);

  const photo = useProfilePhoto();
  const displayName = user?.name || user?.email || 'User';
  const displayEmail = user?.email || '';
  const unreadCount = inbox.filter((item) => item.unread).length;

  const handleLogout = async () => {
    await logout();
    navigate('/auth/login');
  };

  const openNotification = (item) => {
    setReadIds((prev) => new Set([...prev, item.id]));
    navigate(item.href);
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))]/80 backdrop-blur-xl px-4 sm:px-6">
      {photo.input}
      <div className="flex items-center gap-2 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="hover:bg-[hsl(var(--color-muted))] lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <BrandLogo className="h-8 w-8 lg:hidden" />

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="hidden lg:flex hover:bg-[hsl(var(--color-muted))]"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {breadcrumbs.length > 0 && (
          <div className="hidden sm:block">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        )}
      </div>

      <div className="flex-1 flex justify-center px-2 sm:px-4 lg:px-8">
        <div className="relative w-full max-w-md hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search orders, products, customers..."
            className="w-full rounded-lg border border-[hsl(var(--color-border-premium))] bg-[hsl(var(--color-card-bg))] px-4 py-2 pl-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--color-primary-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary-blue))]/20 transition-all"
            style={{
              backgroundColor: 'hsl(var(--color-card-bg))',
              color: 'hsl(var(--color-foreground))',
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <DropdownMenu
          align="end"
          className="w-[360px] p-0"
          trigger={
            <Button variant="ghost" size="icon" className="relative hover:bg-[hsl(var(--color-muted))]">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-[hsl(var(--color-primary-blue))] to-[hsl(var(--color-indigo-accent))] text-[10px] font-semibold text-white flex items-center justify-center shadow-md">
                  {unreadCount}
                </span>
              )}
            </Button>
          }
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[hsl(var(--color-border-premium))]">
            <div>
              <p className="text-sm font-semibold">Notifications</p>
              <p className="text-xs text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-[hsl(var(--color-primary-blue))] hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  setReadIds((prev) => new Set([...prev, ...inbox.map((item) => item.id)]));
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto py-1">
            {inbox.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No alerts right now.</p>
            )}
            {inbox.map((item) => {
              const Icon = NOTIFICATION_ICONS[item.type] || Bell;
              const tone = NOTIFICATION_TONES[item.type] || 'bg-muted text-muted-foreground';
              return (
                <DropdownMenuItem
                  key={item.id}
                  className="items-start gap-3 rounded-none px-4 py-3 hover:bg-[hsl(var(--color-muted))]/70"
                  onClick={() => openNotification(item)}
                >
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn('text-sm leading-5', item.unread ? 'font-semibold' : 'font-medium')}>
                        {item.title}
                      </span>
                      {item.unread && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--color-primary-blue))]" />
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/80">{item.time}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>

          <div className="border-t border-[hsl(var(--color-border-premium))] p-1.5">
            <DropdownMenuItem
              className="justify-center py-2.5 text-sm font-medium text-[hsl(var(--color-primary-blue))]"
              onClick={() => navigate('/notifications')}
            >
              View all notifications
            </DropdownMenuItem>
          </div>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="hover:bg-[hsl(var(--color-muted))]"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>

        <DropdownMenu
          align="end"
          className="w-[280px] p-0"
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 sm:gap-2.5 rounded-lg px-1.5 py-1 hover:bg-[hsl(var(--color-muted))] transition-all"
            >
              <ProfileAvatar src={photo.src} name={displayName} className="h-8 w-8" />
              <div className="hidden lg:block text-left">
                <div className="text-sm font-medium leading-tight text-foreground">{displayName}</div>
                <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{displayEmail}</div>
              </div>
              <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-muted-foreground" />
            </button>
          }
        >
          <div className="flex items-center gap-3 px-3.5 py-3 border-b border-[hsl(var(--color-border-premium))]">
            <ProfileAvatar src={photo.src} name={displayName} className="h-10 w-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
              <span className="mt-1 inline-flex rounded-full bg-[hsl(var(--color-muted))] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {user?.tenantName ? `${user.tenantName} · ` : ''}
                {ROLE_LABELS[effectiveRole] || ROLE_LABELS[activeRole] || 'Admin'}
              </span>
            </div>
          </div>

          <div className="p-1.5">
            <DropdownMenuItem onClick={photo.pick} disabled={photo.busy}>
              <Camera className="h-4 w-4 text-muted-foreground" />
              {photo.busy ? 'Saving photo…' : 'Change photo'}
            </DropdownMenuItem>
            {photo.hasPhoto && (
              <DropdownMenuItem onClick={photo.remove} disabled={photo.busy}>
                Remove photo
              </DropdownMenuItem>
            )}
            {canOpenPath('/settings') && (
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="h-4 w-4 text-muted-foreground" />
                Settings
              </DropdownMenuItem>
            )}
            {canOpenPath('/notifications') && (
              <DropdownMenuItem onClick={() => navigate('/notifications')}>
                <Bell className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">Notifications</span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-[hsl(var(--color-primary-blue))] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unreadCount}
                  </span>
                )}
              </DropdownMenuItem>
            )}
            {canOpenPath('/users-roles') && (
              <DropdownMenuItem onClick={() => navigate('/users-roles')}>
                <Users className="h-4 w-4 text-muted-foreground" />
                Users & Roles
              </DropdownMenuItem>
            )}
            {canOpenPath('/audit-logs') && (
              <DropdownMenuItem onClick={() => navigate('/audit-logs')}>
                <FileText className="h-4 w-4 text-muted-foreground" />
                Audit Logs
              </DropdownMenuItem>
            )}
          </div>

          <DropdownMenuSeparator className="mx-0" />

          <div className="p-1.5">
            <DropdownMenuItem className="text-destructive hover:text-destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </div>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default AdminHeader;
