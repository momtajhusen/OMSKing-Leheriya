import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { User, Mail, Building2, Lock, Layers, Crown } from 'lucide-react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useAuth } from '../../hooks/useAuth';
import { ROLES } from '../../constants/roles';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().min(1, 'Email is required').email('Invalid email format'),
  company: z.string().min(2, 'Company name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = (data) => {
    const tenantId = `TNT-${Date.now().toString().slice(-6)}`;
    login(`trial-${tenantId}`, {
      email: data.email,
      name: data.name,
      role: ROLES.SUPER_ADMIN,
      tenantId,
      tenantName: data.company,
    });
    toast.success(`${data.company} trial is ready. You are the merchant Super Admin.`);
    navigate('/dashboard');
  };

  return (
    <div className="w-full">
      <div className="relative rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-indigo-500 to-violet-500 p-[1.5px] shadow-[0_28px_70px_-24px_rgba(37,99,235,0.45)]">
        <div className="relative overflow-hidden rounded-[1.65rem] bg-white px-6 py-6 sm:px-8">
          <div className="mb-5 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Start a merchant trial</h1>
            <p className="mt-1 text-sm text-slate-500">You become this company’s Super Admin — not the SaaS owner.</p>
          </div>

          <div className="mb-5 grid grid-cols-3 gap-2">
            {[
              { icon: Building2, label: 'Company', tone: 'bg-sky-50 text-sky-700' },
              { icon: Layers, label: 'Tenant', tone: 'bg-blue-50 text-blue-700' },
              { icon: Crown, label: 'Super Admin', tone: 'bg-violet-50 text-violet-700' },
            ].map((step) => (
              <div key={step.label} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold ${step.tone}`}>
                <step.icon className="h-3.5 w-3.5" />
                {step.label}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-1">
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
              <Input id="name" placeholder="Your name" iconLeft={<User className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('name')} error={errors.name?.message} />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <Input id="email" type="email" placeholder="you@company.com" iconLeft={<Mail className="h-4 w-4" />} className="h-11 rounded-xl bg-slate-50" {...register('email')} error={errors.email?.message} />
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
            <label htmlFor="terms" className="flex items-start gap-2 sm:col-span-2 text-sm text-slate-500">
              <input type="checkbox" id="terms" className="mt-1 rounded" required />
              <span>
                I agree to the{' '}
                <a href="#" className="font-medium text-blue-700 hover:underline">Terms</a>
                {' '}and{' '}
                <a href="#" className="font-medium text-blue-700 hover:underline">Privacy Policy</a>
              </span>
            </label>
            <Button type="submit" className="h-11 w-full rounded-full sm:col-span-2">
              Create merchant account
            </Button>
          </form>
        </div>
      </div>

      <p className="mt-5 pb-2 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => navigate('/auth/login')}>
          Sign in
        </button>
      </p>
    </div>
  );
}
