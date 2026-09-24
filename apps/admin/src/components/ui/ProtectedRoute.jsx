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
  const pathKey = requiredPermission ?? ROUTE_PERMISSION[location.pathname];
  if (pathKey && !hasPermission(granted, pathKey)) {
    return <Navigate to={homePathForRole(effectiveRole)} replace />;
  }

  return children;
};

export default ProtectedRoute;
