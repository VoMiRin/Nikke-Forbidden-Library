/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './index.tsx',
  ],
  theme: {
    extend: {
      colors: {
        'nikke-bg': 'rgb(var(--nikke-bg) / <alpha-value>)',
        'nikke-bg-alt': 'rgb(var(--nikke-bg-alt) / <alpha-value>)',
        'nikke-surface': 'rgb(var(--nikke-surface) / <alpha-value>)',
        'nikke-surface-low': 'rgb(var(--nikke-surface-low) / <alpha-value>)',
        'nikke-surface-high': 'rgb(var(--nikke-surface-high) / <alpha-value>)',
        'nikke-surface-highest': 'rgb(var(--nikke-surface-highest) / <alpha-value>)',
        'nikke-text-primary': 'rgb(var(--nikke-text-primary) / <alpha-value>)',
        'nikke-text-secondary': 'rgb(var(--nikke-text-secondary) / <alpha-value>)',
        'nikke-text-muted': 'rgb(var(--nikke-text-muted) / <alpha-value>)',
        'nikke-accent': 'rgb(var(--nikke-accent) / <alpha-value>)',
        'nikke-accent-strong': 'rgb(var(--nikke-accent-strong) / <alpha-value>)',
        'nikke-border': 'rgb(var(--nikke-border) / <alpha-value>)',
        'nikke-glow': 'rgb(var(--nikke-glow) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        headline: ['Manrope', 'sans-serif'],
        body: ['Noto Serif KR', 'serif'],
        label: ['Inter', 'sans-serif'],
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      boxShadow: {
        glass: '0 24px 80px -40px rgba(56, 189, 248, 0.35)',
        ambient: '0 40px 80px -48px rgba(56, 189, 248, 0.22)',
      },
      backgroundImage: {
        'nikke-gradient': 'linear-gradient(135deg, rgb(var(--nikke-accent)) 0%, rgb(var(--nikke-accent-strong)) 100%)',
      },
    },
  },
};
