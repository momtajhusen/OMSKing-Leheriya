import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { attachPermissions } from '../../constants/permissions';
import { accessDecision } from '../../lib/routeAccess';
import PageLoader from './PageLoader';

const ProtectedRoute = ({ children, requiredRole = null, requiredRoles = null, requiredPermission = null }) => {
  const { isAuthenticated, loading, effectiveRole, user } = useAuth();
  const location = useLocation();
  const roles = requiredRoles || (requiredRole ? [requiredRole] : null);

  if (loading) {
    return <PageLoader fullscreen label="Signing you in…" />;
  }

  const decision = accessDecision({
    isAuthenticated,
    role: effectiveRole,
    pathname: location.pathname,
    permissions: attachPermissions(user)?.permissions || [],
    requiredRoles: roles,
    requiredPermission,
  });
  if (decision.redirectTo) return <Navigate to={decision.redirectTo} replace />;
  return children;
};

export default ProtectedRoute;
