/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{tsx,ts,jsx,js}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0f1117',
          800: '#1a1d27',
          700: '#242837',
          600: '#2e3347'
        }
      }
    }
  },
  plugins: []
}
