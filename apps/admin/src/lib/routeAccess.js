import { homePathForRole } from '../constants/roles.js';
import { hasPermission, ROUTE_PERMISSION } from '../constants/permissions.js';

export function permissionForPath(pathname) {
  if (ROUTE_PERMISSION[pathname]) return ROUTE_PERMISSION[pathname];
  const match = Object.keys(ROUTE_PERMISSION)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSION[match] : null;
}

/** Where a signed-in user is sent when this path is not theirs. null means the screen may render. */
export function accessDecision({ isAuthenticated, role, pathname, permissions, requiredRoles, requiredPermission = null }) {
  if (!isAuthenticated) return { redirectTo: '/auth/login' };
  if (requiredRoles && !requiredRoles.includes(role)) {
    return { redirectTo: homePathForRole(role) };
  }
  const key = requiredPermission ?? permissionForPath(pathname);
  if (key && !hasPermission(permissions || [], key)) {
    return { redirectTo: homePathForRole(role) };
  }
  return { redirectTo: null };
}
