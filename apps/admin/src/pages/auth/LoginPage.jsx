import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Mail, Lock, ArrowRight, Eye, EyeOff, ShieldCheck, Rocket, PlayCircle } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
import { homePathFor } from '../../lib/routeAccess';
import api, { apiFormError } from '../../lib/api';
import { loginSchema, loginOtpSchema } from '../../lib/validation';
import CompanyChoice, { companiesFromError } from '../../components/auth/CompanyChoice';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, homePath } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [companies, setCompanies] = useState([]);
  const [twoFactor, setTwoFactor] = useState(null);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
    defaultValues: { email: '', password: '', workspace: '' },
  });

  const onSubmit = async (values) => {
    setFormError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/login', values);
      if (data.data?.twoFactorRequired) {
        setTwoFactor({ email: values.email, password: values.password, workspace: values.workspace || '' });
        setOtp('');
        toast.success('OTP sent to your email');
        return;
      }
      login(data.data.accessToken, data.data.user);
      toast.success(`Signed in as ${data.data.user.name}`);
      navigate(homePathFor(data.data.user.role, data.data.user.permissions));
    } catch (err) {
      const pending = err.response?.data?.data;
      if (err.response?.status === 403 && pending?.verificationRequired) {
        toast.success('Verify the OTP sent to your email');
        navigate(`/auth/verify-email?email=${encodeURIComponent(values.email)}`);
        return;
      }
      const parsed = apiFormError(err, 'Invalid email or password.');
      const choices = companiesFromError(err);
      if (parsed.status === 409 && choices.length) {
        setCompanies(choices);
        setFormError('This email is on more than one company. Choose which one.');
        return;
      }
      Object.entries(parsed.fields).forEach(([field, message]) => {
        if (field === 'email' || field === 'password') setError(field, { type: 'server', message });
      });
      const friendly = parsed.status === 401
        ? 'Email or password is incorrect.'
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
            <span className="mkt-brand-mark mx-auto mb-4 rounded-2xl">
              <BrandLogo className="relative h-16 w-16 rounded-2xl shadow-lg shadow-emerald-900/25" />
            </span>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[1.9rem]">
              Welcome <span className="mkt-gradient-text">back</span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to the company you already have.</p>
          </div>

          {twoFactor ? (
            <form
              className="relative space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = loginOtpSchema.safeParse({ otp });
                if (!parsed.success) {
                  setOtpError(parsed.error.issues[0]?.message || 'Enter the 6-digit OTP from Gmail');
                  return;
                }
                setOtpError('');
                setFormError('');
                setSubmitting(true);
                try {
                  const { data } = await api.post('/auth/verify-login', { ...twoFactor, otp: parsed.data.otp });
                  login(data.data.accessToken, data.data.user);
                  toast.success(`Signed in as ${data.data.user.name}`);
                  navigate(homePathFor(data.data.user.role, data.data.user.permissions));
                } catch (err) {
                  const parsedErr = apiFormError(err, 'Could not verify the OTP.');
                  setFormError(parsedErr.message);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {formError && <FormBanner tone="error" title="Could not sign in">{formError}</FormBanner>}
              <p className="text-sm text-slate-500">Enter the 6-digit OTP sent to {twoFactor.email}. It expires in 10 minutes.</p>
              <div>
                <label htmlFor="login-otp" className="mb-1.5 block text-sm font-medium text-slate-700">OTP from Gmail</label>
                <Input id="login-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={otp} onChange={(event) => setOtp(event.target.value)} error={otpError} className="mkt-field h-12 rounded-xl bg-slate-50 tracking-[0.3em]" />
              </div>
              <Button type="submit" disabled={submitting} className="h-12 w-full rounded-full">
                {submitting ? 'Checking…' : 'Verify and sign in'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full rounded-full"
                onClick={() => { setTwoFactor(null); setOtp(''); setFormError(''); }}
              >
                Back
              </Button>
            </form>
          ) : (
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
                className="mkt-field h-12 rounded-xl bg-slate-50"
                {...register('email')}
                error={errors.email?.message}
              />
            </div>
            <CompanyChoice companies={companies} register={register} error={errors.workspace?.message} />
            <div className="relative">
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                iconLeft={<Lock className="h-4 w-4" />}
                className="mkt-field h-12 rounded-xl bg-slate-50 pr-12"
                {...register('password')}
                error={errors.password?.message}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-1.5 top-[1.875rem] flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
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
            <Button type="submit" disabled={submitting} className="mkt-cta-solid group h-12 w-full gap-2 rounded-full bg-gradient-to-r from-emerald-700 to-lime-600 text-sm font-semibold shadow-lg shadow-emerald-700/25 hover:from-emerald-800 hover:to-lime-700">
              {submitting ? 'Signing in…' : 'Sign in'}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Button>
          </form>
          )}

          <p className="relative mt-6 flex items-start justify-center gap-1.5 border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            Signing in opens only your company’s orders, stock and settings.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          { icon: Rocket, label: 'New company?', action: 'Start a trial', to: '/auth/register' },
          { icon: PlayCircle, label: 'See it first?', action: 'Request a demo', to: '/demo' },
        ].map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            className="group flex items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-3 text-left shadow-sm backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
              <item.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-slate-500">{item.label}</span>
              <span className="block whitespace-nowrap text-sm font-semibold text-emerald-700">{item.action}</span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-300 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-emerald-600" />
          </button>
        ))}
      </div>
    </div>
  );
}
