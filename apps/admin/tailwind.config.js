import animate from 'tailwindcss-animate';
import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--color-border) / <alpha-value>)',
        input: 'hsl(var(--color-input) / <alpha-value>)',
        ring: 'hsl(var(--color-ring) / <alpha-value>)',
        background: 'hsl(var(--color-background) / <alpha-value>)',
        foreground: 'hsl(var(--color-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--color-primary) / <alpha-value>)',
          foreground: 'hsl(var(--color-primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--color-secondary) / <alpha-value>)',
          foreground: 'hsl(var(--color-secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--color-destructive) / <alpha-value>)',
          foreground: 'hsl(var(--color-destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--color-muted) / <alpha-value>)',
          foreground: 'hsl(var(--color-muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent) / <alpha-value>)',
          foreground: 'hsl(var(--color-accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--color-popover) / <alpha-value>)',
          foreground: 'hsl(var(--color-popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--color-card) / <alpha-value>)',
          foreground: 'hsl(var(--color-card-foreground) / <alpha-value>)',
        },
        brand: {
          DEFAULT: '#0F172A',
          accent: '#D97706',
          50: '#F8FAFC',
          900: '#0F172A',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(18px, -22px, 0)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(-14px, 16px, 0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'bar-rise': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
        shine: {
          from: { transform: 'translateX(-120%)' },
          to: { transform: 'translateX(120%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.7', transform: 'scale(1.06)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.8s linear infinite',
        float: 'float 12s ease-in-out infinite',
        'float-slow': 'float-slow 16s ease-in-out infinite',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bar-rise': 'bar-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        shine: 'shine 0.7s ease',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25)',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        premium: '180ms',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [animate, typography],
};
