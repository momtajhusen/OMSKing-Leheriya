import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
import { homePathForRole } from '../../constants/roles';
import api, { apiFormError } from '../../lib/api';
import { loginSchema } from '../../lib/validation';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, homePath } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (isAuthenticated) navigate(homePath, { replace: true });
  }, [isAuthenticated, homePath, navigate]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values) => {
    setFormError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/login', values);
      login(data.data.accessToken, data.data.user);
      toast.success(`Signed in as ${data.data.user.name}`);
      navigate(homePathForRole(data.data.user.role));
    } catch (err) {
      const parsed = apiFormError(err, 'Invalid email or password.');
      Object.entries(parsed.fields).forEach(([field, message]) => {
        if (field === 'email' || field === 'password') setError(field, { type: 'server', message });
      });
      const friendly = parsed.status === 401
        ? 'Email or password is incorrect.'
        : parsed.status === 403
          ? parsed.message
          : parsed.message;
      setFormError(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="relative rounded-[1.75rem] bg-gradient-to-br from-emerald-800 via-emerald-600 to-lime-500 p-[1.5px] shadow-[0_28px_70px_-24px_rgba(13,92,69,0.55)]">
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white px-7 pb-8 pt-10 sm:px-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-100/80 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-lime-100/70 blur-2xl" />

          <div className="relative mb-7 text-center">
            <BrandLogo className="mx-auto mb-4 h-16 w-16 rounded-2xl shadow-lg shadow-emerald-900/25" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.7rem]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to Leheriya’s OMSKing tenant</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="relative space-y-4" noValidate>
            {formError && (
              <FormBanner tone="error" title="Could not sign in">
                {formError}
              </FormBanner>
            )}
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
              <Link to="/auth/forgot-password" className="font-medium text-emerald-700 hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" disabled={submitting} className="group h-12 w-full rounded-full text-sm font-semibold shadow-lg shadow-emerald-700/25">
              {submitting ? 'Signing in…' : 'Sign in'}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </form>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        New merchant?{' '}
        <button
          type="button"
          className="font-semibold text-emerald-700 hover:underline"
          onClick={() => navigate('/auth/register')}
        >
          Create an account
        </button>
      </p>
    </div>
  );
}
