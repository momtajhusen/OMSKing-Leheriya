import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { User, Mail, Building2, Lock, Layers, Crown } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner, PasswordHints } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
import { homePathForRole } from '../../constants/roles';
import api, { apiFormError } from '../../lib/api';
import { registerSchema } from '../../lib/validation';
import { SUBSCRIPTION_PLANS } from '../../constants/channelCatalog';

function startingPlan(value) {
  return ['starter', 'growth', 'enterprise'].includes(value) ? value : 'growth';
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      company: '',
      plan: startingPlan(params.get('plan')),
      password: '',
      confirmPassword: '',
      terms: false,
    },
  });

  const password = watch('password', '');

  const onSubmit = async (values) => {
    setFormError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/register', values);
      login(data.data.accessToken, data.data.user);
      toast.success(`${values.company} is on a 14-day ${values.plan} trial. You are the Super Admin.`);
      navigate(homePathForRole(data.data.user.role));
    } catch (err) {
      const parsed = apiFormError(err, 'Could not create the merchant account.');
      Object.entries(parsed.fields).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });
      setFormError(parsed.message === 'Validation failed' ? 'Please fix the highlighted fields.' : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="relative rounded-[1.75rem] bg-gradient-to-br from-emerald-800 via-emerald-600 to-lime-500 p-[1.5px] shadow-[0_28px_70px_-24px_rgba(13,92,69,0.45)]">
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white px-6 py-6 sm:px-8">
          <div className="mb-5 text-center">
            <BrandLogo className="mx-auto mb-4 h-14 w-14 rounded-2xl shadow-lg shadow-emerald-900/25" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your company</h1>
            <p className="mt-1 text-sm text-slate-500">14-day trial. You become this company’s Super Admin. No payment now.</p>
          </div>

          <div className="mb-5 grid grid-cols-3 gap-2">
            {[
              { icon: Building2, label: 'Company', tone: 'bg-emerald-50 text-emerald-700' },
              { icon: Layers, label: 'Tenant', tone: 'bg-teal-50 text-teal-700' },
              { icon: Crown, label: 'Super Admin', tone: 'bg-lime-50 text-lime-800' },
            ].map((step) => (
              <div key={step.label} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold ${step.tone}`}>
                <step.icon className="h-3.5 w-3.5" />
                {step.label}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2" noValidate>
            {formError && (
              <div className="sm:col-span-2">
                <FormBanner tone="error" title="Account not created">{formError}</FormBanner>
              </div>
            )}
            <div className="sm:col-span-1">
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
              <Input id="name" placeholder="Your name" iconLeft={<User className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('name')} error={errors.name?.message} />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <Input id="email" type="email" placeholder="you@company.com" iconLeft={<Mail className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('email')} error={errors.email?.message} />
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-medium text-slate-700">Subscription</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {SUBSCRIPTION_PLANS.map((plan) => (
                  <label key={plan.id} className={`cursor-pointer rounded-xl border px-3 py-2 text-left ${watch('plan') === plan.id ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                    <input type="radio" value={plan.id} className="sr-only" {...register('plan')} />
                    <span className="block text-sm font-semibold text-slate-900">{plan.name}</span>
                    <span className="block text-xs text-slate-500">{plan.price}</span>
                  </label>
                ))}
              </div>
              {errors.plan?.message && (
                <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">{errors.plan.message}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="company" className="mb-1.5 block text-sm font-medium text-slate-700">Company</label>
              <Input id="company" placeholder="Company name" iconLeft={<Building2 className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('company')} error={errors.company?.message} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
              <Input id="password" type="password" placeholder="••••••••" iconLeft={<Lock className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('password')} error={errors.password?.message} />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-slate-700">Confirm</label>
              <Input id="confirmPassword" type="password" placeholder="••••••••" iconLeft={<Lock className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('confirmPassword')} error={errors.confirmPassword?.message} />
            </div>
            <div className="sm:col-span-2">
              <PasswordHints value={password} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="terms" className="flex items-start gap-2 text-sm text-slate-500">
                <input type="checkbox" id="terms" className="mt-1 rounded" {...register('terms')} />
                <span>
                  I agree to the{' '}
                  <a href="#" className="font-medium text-emerald-700 hover:underline">Terms</a>
                  {' '}and{' '}
                  <a href="#" className="font-medium text-emerald-700 hover:underline">Privacy Policy</a>
                </span>
              </label>
              {errors.terms?.message && (
                <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">{errors.terms.message}</p>
              )}
            </div>
            <Button type="submit" disabled={submitting} className="h-11 w-full rounded-full sm:col-span-2">
              {submitting ? 'Creating account…' : 'Create merchant account'}
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-5 grid gap-2 pb-2 text-center text-sm text-slate-500 sm:grid-cols-2">
        <p>
          Already have an account?{' '}
          <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => navigate('/auth/login')}>
            Sign in
          </button>
        </p>
        <p>
          Want a walkthrough first?{' '}
          <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => navigate('/demo')}>
            Request a demo
          </button>
        </p>
      </div>
    </div>
  );
}
