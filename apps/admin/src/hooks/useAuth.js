import useAuthStore from '../stores/authStore';
import { ROLES, homePathForRole } from '../constants/roles';

export const useAuth = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const impersonateTenant = useAuthStore((s) => s.impersonateTenant);
  const exitImpersonation = useAuthStore((s) => s.exitImpersonation);
  const effectiveRole = user?.impersonating ? ROLES.SUPER_ADMIN : user?.role;

  return {
    isAuthenticated,
    user,
    loading,
    login,
    logout,
    impersonateTenant,
    exitImpersonation,
    effectiveRole,
    homePath: homePathForRole(effectiveRole),
  };
};
