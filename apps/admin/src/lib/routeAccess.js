import { homePathForRole } from '../constants/roles.js';
import { hasPermission, ROUTE_PERMISSION } from '../constants/permissions.js';

export function permissionForPath(pathname) {
  if (ROUTE_PERMISSION[pathname]) return ROUTE_PERMISSION[pathname];
  const match = Object.keys(ROUTE_PERMISSION)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSION[match] : null;
}

/** The role's home screen, or the first screen its permissions open (e.g. Orders when Dashboard access is off). */
export function homePathFor(role, permissions) {
  const granted = permissions || [];
  const home = homePathForRole(role);
  if (hasPermission(granted, permissionForPath(home))) return home;
  const vendorSide = role === 'vendor';
  const next = Object.keys(ROUTE_PERMISSION)
    .find((path) => path.startsWith('/vendor/') === vendorSide && hasPermission(granted, ROUTE_PERMISSION[path]));
  return next || home;
}

/** Where a signed-in user is sent when this path is not theirs. null means the screen may render. */
export function accessDecision({ isAuthenticated, role, pathname, permissions, requiredRoles, requiredPermission = null }) {
  if (!isAuthenticated) return { redirectTo: '/auth/login' };
  if (requiredRoles && !requiredRoles.includes(role)) {
    return { redirectTo: homePathFor(role, permissions) };
  }
  const key = requiredPermission ?? permissionForPath(pathname);
  if (key && !hasPermission(permissions || [], key)) {
    return { redirectTo: homePathFor(role, permissions) };
  }
  return { redirectTo: null };
}
