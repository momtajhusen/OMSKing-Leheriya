import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Mail, ShieldCheck } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { FormBanner } from '../../components/ui/FormBanner';
import { useAuth } from '../../hooks/useAuth';
import { homePathForRole } from '../../constants/roles';
import api, { apiFormError } from '../../lib/api';
import { verifyEmailSchema } from '../../lib/validation';
import CompanyChoice, { companiesFromError } from '../../components/auth/CompanyChoice';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login } = useAuth();
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [companies, setCompanies] = useState([]);

  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { email: params.get('email') || '', workspace: '', otp: '' },
  });

  const onSubmit = async (values) => {
    setFormError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/verify-email', values);
      login(data.data.accessToken, data.data.user);
      toast.success('Email verified. Your company is open.');
      navigate(homePathForRole(data.data.user.role));
    } catch (err) {
      const parsed = apiFormError(err, 'Could not verify the OTP.');
      const choices = companiesFromError(err);
      if (parsed.status === 409 && choices.length) {
        setCompanies(choices);
        setFormError('This email is on more than one company. Choose which one.');
        return;
      }
      if (parsed.fields.otp) setError('otp', { type: 'server', message: parsed.fields.otp });
      if (parsed.fields.email) setError('email', { type: 'server', message: parsed.fields.email });
      setFormError(parsed.message === 'Validation failed' ? 'Enter the 6-digit OTP from Gmail.' : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setFormError('');
    setResending(true);
    try {
      const email = getValues('email');
      await api.post('/auth/resend-verification', { email, workspace: getValues('workspace') || undefined });
      toast.success('If that email is waiting, a new OTP was sent.');
    } catch (err) {
      const parsed = apiFormError(err, 'Could not resend the OTP.');
      setFormError(parsed.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full">
      <div className="relative rounded-[1.75rem] bg-gradient-to-br from-emerald-800 via-emerald-600 to-lime-500 p-[1.5px] shadow-[0_28px_70px_-24px_rgba(13,92,69,0.45)]">
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white px-6 py-6 sm:px-8">
          <div className="mb-5 text-center">
            <BrandLogo className="mx-auto mb-4 h-14 w-14 rounded-2xl shadow-lg shadow-emerald-900/25" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Verify your email</h1>
            <p className="mt-1 text-sm text-slate-500">Enter the 6-digit OTP from Gmail. It expires in 10 minutes. The company stays closed until this matches.</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
            {formError && <FormBanner tone="error" title="Email not verified">{formError}</FormBanner>}
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" iconLeft={<Mail className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('email')} error={errors.email?.message} />
            </div>
            <CompanyChoice companies={companies} register={register} error={errors.workspace?.message} />
            <div>
              <label htmlFor="otp" className="mb-1.5 block text-sm font-medium text-slate-700">OTP from Gmail</label>
              <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" iconLeft={<ShieldCheck className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50 tracking-[0.3em]" {...register('otp')} error={errors.otp?.message} />
            </div>
            <Button type="submit" disabled={submitting} className="h-11 w-full rounded-full">
              {submitting ? 'Checking…' : 'Verify and open company'}
            </Button>
            <Button type="button" variant="outline" disabled={resending} className="h-11 w-full rounded-full" onClick={resend}>
              {resending ? 'Sending…' : 'Resend OTP'}
            </Button>
          </form>
        </div>
      </div>
      <p className="mt-5 text-center text-sm text-slate-500">
        Already verified?{' '}
        <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => navigate('/auth/login')}>
          Sign in
        </button>
      </p>
    </div>
  );
}
