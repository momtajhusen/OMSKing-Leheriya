import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { homePathForRole } from '../../constants/roles';
import { hasPermission, attachPermissions, ROUTE_PERMISSION } from '../../constants/permissions';

const ProtectedRoute = ({ children, requiredRole = null, requiredRoles = null, requiredPermission = null }) => {
  const { isAuthenticated, loading, effectiveRole, user } = useAuth();
  const location = useLocation();
  const roles = requiredRoles || (requiredRole ? [requiredRole] : null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
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
