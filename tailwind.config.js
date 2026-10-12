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
        'nikke-accent-ink': 'rgb(var(--nikke-accent-ink) / <alpha-value>)',
        'nikke-highlight': 'rgb(var(--nikke-highlight) / <alpha-value>)',
        'nikke-border': 'rgb(var(--nikke-border) / <alpha-value>)',
        'nikke-border-strong': 'rgb(var(--nikke-border-strong) / <alpha-value>)',
        'nikke-glow': 'rgb(var(--nikke-glow) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans KR"', 'sans-serif'],
        label: ['"IBM Plex Sans KR"', 'sans-serif'],
        // 제목·숫자: 대비가 큰 디스플레이 명조 / 본문: 오래 읽기 편한 바탕체
        headline: ['Hahmlet', '"Noto Serif KR"', 'serif'],
        body: ['"Gowun Batang"', '"Noto Serif KR"', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      boxShadow: {
        glass: 'none',
        ambient: 'none',
      },
      backgroundImage: {
        'nikke-gradient': 'linear-gradient(rgb(var(--nikke-accent)), rgb(var(--nikke-accent)))',
      },
    },
  },
};
