/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          900: '#134e4a',
        },
        river: {
          deep: '#0a192f',
          teal: '#00b4d8',
          foam: '#e0f7fa',
        },
        // Light "river mist" theme used by the sign-in screen (/login).
        aqua: { light: '#22d3ee', DEFAULT: '#06b6d4', dark: '#0891b2' },
        sand: '#e8b547',
        ink: { strong: '#061320', DEFAULT: '#0f2230', muted: '#547080', line: 'rgba(15, 34, 48, 0.12)' },
        navy: '#0e2a4a',
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        field: '10px',
        cta: '14px',
      },
      boxShadow: {
        cta: '0 1px 0 rgba(255,255,255,.5) inset, 0 -1px 0 rgba(8,145,178,.45) inset, 0 10px 22px rgba(6,182,212,.4), 0 2px 4px rgba(6,182,212,.2)',
        'cta-hover': '0 1px 0 rgba(255,255,255,.6) inset, 0 -1px 0 rgba(8,145,178,.5) inset, 0 14px 28px rgba(6,182,212,.45), 0 4px 6px rgba(6,182,212,.25)',
      },
      backgroundImage: {
        'aqua-glossy': 'linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 45%), linear-gradient(180deg, #22d3ee, #06b6d4 55%, #0891b2)',
        'page-mist':
          'radial-gradient(1200px 600px at 50% -200px, rgba(6,182,212,.1), transparent 60%), radial-gradient(800px 500px at 90% 20%, rgba(232,181,71,.08), transparent 60%), linear-gradient(180deg, #f4fafc, #f0f8fb 60%, #e8f3f7)',
      },
    },
  },
  plugins: [],
}
