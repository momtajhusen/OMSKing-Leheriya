import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Lock, CheckCircle, ArrowLeft } from 'lucide-react';

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = (data) => {
    // In real app, you would validate token and update password
    toast.success('Password reset successfully!');
    navigate('/auth/login');
  };

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg">
          <Lock className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Reset Password</h1>
        <p className="text-muted-foreground">Create a new secure password for your account</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                New Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                {...register('password')}
                error={errors.password?.message}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                {...register('confirmPassword')}
                error={errors.confirmPassword?.message}
              />
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">Password requirements:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  At least 8 characters
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  Contains uppercase and lowercase letters
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  Contains at least one number
                </li>
              </ul>
            </div>

            <Button type="submit" className="w-full">
              Reset Password
            </Button>
          </form>

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