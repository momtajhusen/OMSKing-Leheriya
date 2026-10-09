import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { homePathForRole } from '../../constants/roles';
import { hasPermission, attachPermissions, ROUTE_PERMISSION } from '../../constants/permissions';
import PageLoader from './PageLoader';

const ProtectedRoute = ({ children, requiredRole = null, requiredRoles = null, requiredPermission = null }) => {
  const { isAuthenticated, loading, effectiveRole, user } = useAuth();
  const location = useLocation();
  const roles = requiredRoles || (requiredRole ? [requiredRole] : null);

  if (loading) {
    return <PageLoader fullscreen label="Signing you in…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" replace />;
  }

  if (roles && !roles.includes(effectiveRole)) {
    return <Navigate to={homePathForRole(effectiveRole)} replace />;
  }

  const granted = attachPermissions(user)?.permissions || [];
  const pathKey = requiredPermission ?? permissionForPath(location.pathname);
  if (pathKey && !hasPermission(granted, pathKey)) {
    return <Navigate to={homePathForRole(effectiveRole)} replace />;
  }

  return children;
};

function permissionForPath(pathname) {
  if (ROUTE_PERMISSION[pathname]) return ROUTE_PERMISSION[pathname];
  const match = Object.keys(ROUTE_PERMISSION)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSION[match] : null;
}

export default ProtectedRoute;
