import { Menu, Bell, Sun, Moon, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import useThemeStore from '../../stores/themeStore';
import useUIStore from '../../stores/uiStore';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu';
import Avatar from '../ui/Avatar';
import Breadcrumbs from '../ui/Breadcrumbs';
import Button from '../ui/Button';
import Input from '../ui/Input';

function AdminHeader() {
  const { theme, toggleTheme } = useThemeStore();
  const { sidebarCollapsed, toggleSidebar, breadcrumbs } = useUIStore();

  return (
    <header className="flex h-16 items-center border-b bg-background px-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>
        
        {breadcrumbs.length > 0 && (
          <Breadcrumbs items={breadcrumbs} />
        )}
      </div>

      <div className="flex-1 flex justify-center">
        <div className="w-96">
          <Input
            placeholder="Search..."
            iconLeft={<Search className="h-4 w-4 text-muted-foreground" />}
            className="bg-muted"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu
          trigger={
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-xs text-white flex items-center justify-center">
                5
              </span>
            </Button>
          }
          align="end"
        >
          <DropdownMenuItem>Order #65207 shipped</DropdownMenuItem>
          <DropdownMenuItem>New vendor assigned</DropdownMenuItem>
          <DropdownMenuItem>Inventory low alert</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>View all notifications</DropdownMenuItem>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </Button>

        <DropdownMenu
          trigger={
            <div className="flex items-center gap-2 cursor-pointer">
              <Avatar
                src="https://i.pravatar.cc/150?img=68"
                alt="Momtaj Husen"
                fallback="MH"
              />
              <div className="hidden md:block">
                <div className="text-sm font-medium">Momtaj Husen</div>
                <div className="text-xs text-muted-foreground">thecodersalpha@gmail.com</div>
              </div>
            </div>
          }
          align="end"
        >
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Switch Role</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive">Logout</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default AdminHeader;