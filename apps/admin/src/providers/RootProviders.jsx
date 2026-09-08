import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import useThemeStore from '../stores/themeStore';

export default function RootProviders({ children }) {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);

  useEffect(() => {
    initializeTheme();
  }, [initializeTheme]);

  return (
    <>
      {children}
      <Toaster
        position="top-right"
        duration={2800}
        toastOptions={{
          className: '',
          style: {
            background: 'hsl(var(--color-card))',
            color: 'hsl(var(--color-card-foreground))',
            border: '1px solid hsl(var(--color-border))',
            borderRadius: 'var(--radius)',
            fontFamily: 'Inter, sans-serif',
            transition: 'all 180ms cubic-bezier(0.22, 1, 0.36, 1)',
          },
          success: {
            iconTheme: {
              primary: 'hsl(var(--color-primary))',
              secondary: 'hsl(var(--color-primary-foreground))',
            },
          },
          error: {
            iconTheme: {
              primary: 'hsl(var(--color-destructive))',
              secondary: 'hsl(var(--color-destructive-foreground))',
            },
          },
        }}
      />
    </>
  );
}