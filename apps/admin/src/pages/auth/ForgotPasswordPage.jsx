import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Alert, AlertDescription } from '../../components/ui/Alert';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
});

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = (data) => {
    toast.success('Password reset link sent to your email');
    setSubmitted(true);
  };

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
          <Mail className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Forgot Password</h1>
        <p className="text-muted-foreground">
          {submitted 
            ? 'Check your email for reset instructions' 
            : 'Enter your email to receive a password reset link'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            {submitted 
              ? 'Reset link sent successfully' 
              : 'We\'ll send you a link to reset your password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <Alert className="border-green-200 bg-green-50 dark:bg-green-900/20">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                Password reset link has been sent to your email address. Please check your inbox and follow the instructions.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register('email')}
                  error={errors.email?.message}
                />
              </div>

              <Button type="submit" className="w-full">
                Send Reset Link
              </Button>
            </form>
          )}

          <div className="mt-6">
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => navigate('/auth/login')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}