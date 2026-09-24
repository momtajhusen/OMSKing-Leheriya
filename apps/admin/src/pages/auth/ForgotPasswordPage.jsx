import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { FormBanner } from '../../components/ui/FormBanner';
import { ArrowLeft } from 'lucide-react';
import BrandLogo from '../../components/brand/BrandLogo';
import api, { apiFormError } from '../../lib/api';
import { forgotPasswordSchema } from '../../lib/validation';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (data) => {
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', data);
      setEmailSentTo(data.email);
      setSubmitted(true);
    } catch (err) {
      const parsed = apiFormError(err, 'Could not send the OTP.');
      if (parsed.fields.email) setError('email', { type: 'server', message: parsed.fields.email });
      setFormError(parsed.message === 'Validation failed' ? 'Enter a valid email address.' : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <BrandLogo className="mb-4 h-16 w-16 rounded-2xl shadow-lg shadow-emerald-900/25" />
        <h1 className="text-3xl font-bold mb-2">Forgot Password</h1>
        <p className="text-muted-foreground">
          {submitted
            ? 'Check Gmail for a 6-digit OTP'
            : 'Enter your email. We send a 6-digit OTP to Gmail.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            {submitted ? 'OTP expires in 10 minutes' : 'The code is sent to the same Gmail as the account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <FormBanner tone="success" title="OTP sent">
                If {emailSentTo} is registered, open Gmail and enter the 6-digit code on the next screen.
              </FormBanner>
              <Button
                className="w-full"
                onClick={() => navigate(`/auth/reset-password?email=${encodeURIComponent(emailSentTo)}`)}
              >
                Enter OTP
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {formError && <FormBanner tone="error" title="Could not send OTP">{formError}</FormBanner>}
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">Email Address</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@gmail.com"
                  {...register('email')}
                  error={errors.email?.message}
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Sending…' : 'Send OTP to Gmail'}
              </Button>
            </form>
          )}

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
