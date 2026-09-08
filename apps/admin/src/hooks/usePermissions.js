import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { hasPermission, attachPermissions, ROUTE_PERMISSION } from '../constants/permissions';
import { PERMISSIONS } from '../constants/permissions';

export function usePermissions() {
  const { user } = useAuth();
  const granted = useMemo(() => attachPermissions(user)?.permissions || [], [user]);

  return {
    granted,
    can: (key) => hasPermission(granted, key),
    canUsers: hasPermission(granted, PERMISSIONS.USERS_MANAGE),
    canOpenPath: (path) => hasPermission(granted, ROUTE_PERMISSION[path] ?? null),
  };
}
