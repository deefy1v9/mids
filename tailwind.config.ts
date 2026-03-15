import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'chart-tooltip-foreground': 'var(--chart-foreground)',
        'chart-tooltip-muted': 'var(--chart-foreground-muted)',
        'chart-label': 'var(--chart-label)',
        'popover': 'rgba(255,255,255,0.96)',
        'popover-foreground': 'var(--chart-foreground)',
      },
    },
  },
  plugins: [],
};

export default config;
