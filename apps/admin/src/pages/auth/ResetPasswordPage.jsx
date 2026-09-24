import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { FormBanner, PasswordHints } from '../../components/ui/FormBanner';
import { ArrowLeft } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import api, { apiFormError } from '../../lib/api';
import { resetPasswordSchema } from '../../lib/validation';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailFromQuery = searchParams.get('email') || '';
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: emailFromQuery, otp: '', password: '', confirmPassword: '' },
  });

  const password = watch('password', '');

  const onSubmit = async (data) => {
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', {
        email: data.email,
        otp: data.otp,
        password: data.password,
      });
      toast.success('Password updated. Sign in with the new password.');
      navigate('/auth/login');
    } catch (err) {
      const parsed = apiFormError(err, 'Could not reset the password.');
      ['email', 'otp', 'password'].forEach((field) => {
        if (parsed.fields[field]) setError(field, { type: 'server', message: parsed.fields[field] });
      });
      setFormError(parsed.message === 'Validation failed' ? 'Please fix the highlighted fields.' : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resendOtp = async () => {
    const email = getValues('email');
    if (!email) {
      setFormError('Enter the account email first.');
      return;
    }
    setFormError('');
    setResending(true);
    try {
      await api.post('/auth/forgot-password', { email });
      toast.success('A new OTP was sent to Gmail.');
    } catch (err) {
      setFormError(apiFormError(err, 'Could not resend OTP.').message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <BrandLogo className="mb-4 h-16 w-16 rounded-2xl shadow-lg shadow-emerald-900/25" />
        <h1 className="text-3xl font-bold mb-2">Reset Password</h1>
        <p className="text-muted-foreground">Enter the OTP from Gmail, then choose a new password</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>OTP + new password</CardTitle>
          <CardDescription>OTP is 6 digits and expires in 10 minutes</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {formError && (
              <FormBanner tone="error" title="Password not updated">{formError}</FormBanner>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">Email</label>
              <Input id="email" type="email" placeholder="you@gmail.com" {...register('email')} error={errors.email?.message} />
            </div>
            <div>
              <label htmlFor="otp" className="block text-sm font-medium mb-2">OTP from Gmail</label>
              <Input id="otp" inputMode="numeric" maxLength={6} placeholder="123456" {...register('otp')} error={errors.otp?.message} />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">New Password</label>
              <Input id="password" type="password" placeholder="••••••••" {...register('password')} error={errors.password?.message} />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">Confirm Password</label>
              <Input id="confirmPassword" type="password" placeholder="••••••••" {...register('confirmPassword')} error={errors.confirmPassword?.message} />
            </div>
            <PasswordHints value={password} />
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Saving…' : 'Reset Password'}
            </Button>
            <Button type="button" variant="outline" disabled={resending} className="w-full" onClick={resendOtp}>
              {resending ? 'Sending…' : 'Resend OTP'}
            </Button>
          </form>

          <div className="mt-6">
            <Button variant="ghost" className="w-full" onClick={() => navigate('/auth/login')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
