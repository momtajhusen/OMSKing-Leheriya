import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Mail, Lock, ArrowRight, Crown } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { findDemoAccount } from '../../mocks/platform';
import { homePathForRole } from '../../constants/roles';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, homePath } = useAuth();

  useEffect(() => {
    if (isAuthenticated) navigate(homePath, { replace: true });
  }, [isAuthenticated, homePath, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = (data) => {
    const account = findDemoAccount(data.email, data.password);
    if (!account) {
      toast.error('Invalid email or password.');
      return;
    }
    login(`session-${account.role}-${Date.now()}`, {
      email: account.email,
      name: account.name,
      role: account.role,
      tenantId: account.tenantId,
      tenantName: account.tenantName,
      vendorId: account.vendorId || null,
    });
    toast.success(`Signed in as ${account.name}`);
    navigate(homePathForRole(account.role));
  };

  return (
    <div className="w-full">
      <div className="relative rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 p-[1.5px] shadow-[0_28px_70px_-24px_rgba(37,99,235,0.55)]">
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white px-7 pb-8 pt-10 sm:px-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-blue-100/80 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-violet-100/70 blur-2xl" />

          <div className="relative mb-7 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30">
              <Crown className="h-7 w-7" strokeWidth={2.2} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.7rem]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to Leheriya’s OMSKing tenant</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="relative space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                iconLeft={<Mail className="h-4 w-4" />}
                className="h-12 rounded-xl bg-slate-50"
                {...register('email')}
                error={errors.email?.message}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                iconLeft={<Lock className="h-4 w-4" />}
                className="h-12 rounded-xl bg-slate-50"
                {...register('password')}
                error={errors.password?.message}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-slate-500">
                <input type="checkbox" className="rounded border-slate-300" />
                Remember me
              </label>
              <Link to="/auth/forgot-password" className="font-medium text-blue-700 hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="group h-12 w-full rounded-full text-sm font-semibold shadow-lg shadow-indigo-500/25">
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </form>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        New merchant?{' '}
        <button
          type="button"
          className="font-semibold text-blue-700 hover:underline"
          onClick={() => navigate('/auth/register')}
        >
          Create an account
        </button>
      </p>
    </div>
  );
}
