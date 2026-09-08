import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { LayoutDashboard, Store } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = (data) => {
    toast.success('Login successful!');
    navigate('/dashboard');
  };

  const handleDemoSuperAdmin = () => {
    localStorage.setItem('demo-role', 'super_admin');
    toast.success('Demo Super Admin role activated');
    setTimeout(() => navigate('/dashboard'), 1500);
  };

  const handleDemoVendor = () => {
    localStorage.setItem('demo-role', 'vendor');
    toast.success('Demo Vendor role activated');
    setTimeout(() => navigate('/vendor/dashboard'), 1500);
  };

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
          <LayoutDashboard className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
        <p className="text-muted-foreground">Sign in to your OMSKing account</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>Enter your credentials to access your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                {...register('email')}
                error={errors.email?.message}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                {...register('password')}
                error={errors.password?.message}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="rounded" />
                <span className="text-muted-foreground">Remember me</span>
              </label>
              <a href="/auth/forgot-password" className="text-primary hover:underline">
                Forgot password?
              </a>
            </div>

            <Button type="submit" className="w-full">
              Sign In
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-muted-foreground">Demo Access</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDemoSuperAdmin}
              >
                <LayoutDashboard className="w-4 h-4 mr-2" />
                Continue as Demo Super Admin
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDemoVendor}
              >
                <Store className="w-4 h-4 mr-2" />
                Continue as Demo Vendor
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}