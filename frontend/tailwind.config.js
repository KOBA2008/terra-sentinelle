/** @type {import('tailwindcss').Config} */
/**
 * Toutes les couleurs sont des variables CSS redéfinies par thème (voir src/index.css).
 * Les jetons chromatiques sont exposés en triplets RVB pour conserver les
 * modificateurs d'opacité de Tailwind (bg-accent/15, text-ink/90, …).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: 'rgb(var(--bg-deep-rgb) / <alpha-value>)',
        base: 'rgb(var(--bg-rgb) / <alpha-value>)',
        raise: 'rgb(var(--bg-raise-rgb) / <alpha-value>)',
        ink: 'rgb(var(--text-rgb) / <alpha-value>)',
        dim: 'rgb(var(--dim-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        amber: 'rgb(var(--amber-rgb) / <alpha-value>)',
        danger: 'rgb(var(--red-rgb) / <alpha-value>)',
        sand: 'rgb(var(--sand-rgb) / <alpha-value>)',
        water: 'rgb(var(--water-rgb) / <alpha-value>)',
        // Variantes lisibles en petit texte (WCAG AA dans les deux thèmes)
        'accent-ink': 'var(--accent-ink)',
        'amber-ink': 'var(--amber-ink)',
        'red-ink': 'var(--red-ink)',
        'sand-ink': 'var(--sand-ink)',
        // Surfaces et filets translucides, inversés par thème
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        surf: 'var(--surf)',
        'surf-2': 'var(--surf-2)',
        'surf-3': 'var(--surf-3)',
        field: 'var(--field)',
        'field-brd': 'var(--field-brd)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        glass: '24px',
        squircle: '28px',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.22,1,.36,1)',
      },
      boxShadow: {
        glass: 'var(--glass-shadow)',
        float: 'var(--glass-shadow)',
        soft: 'var(--glass-shadow-soft)',
      },
    },
  },
  plugins: [],
}
