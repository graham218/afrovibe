/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.{ejs,html}",
    "./views/partials/**/*.{ejs,html}",
    "./public/**/*.html",
    "./public/**/*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Put DM Sans first for the “Bumble-ish” feel
        sans: ["DM Sans", "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "sans-serif"],
      },
      fontSize: {
        xs:  ['0.8125rem', { lineHeight: '1.4' }],  // 13px
        sm:  ['0.9375rem', { lineHeight: '1.5' }],  // 15px
        base:['1.0625rem', { lineHeight: '1.6' }],  // 17px
        lg:  ['1.1875rem', { lineHeight: '1.6' }],  // 19px
        xl:  ['1.375rem',  { lineHeight: '1.35' }], // 22px
        '2xl':['1.625rem',  { lineHeight: '1.25' }], // 26px
        '3xl':['2rem',      { lineHeight: '1.15' }], // 32px
        '4xl':['2.5rem',    { lineHeight: '1.1'  }], // 40px
        '5xl':['3rem',      { lineHeight: '1.05' }]  // 48px
      },
      colors: {
        "brand-start": "#FF6B6B",
        "brand-end":   "#FECA57",
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/line-clamp"),
    require("@tailwindcss/aspect-ratio"),
    require("daisyui"),
  ],
  daisyui: {
    themes: [{
      afrovibe: {
        primary:   "#6556FF",
        secondary: "#00B3A4",
        accent:    "#FF7A59",
        neutral:   "#1f2937",
        "base-100":"#0b1220",
        "base-200":"#0f172a",
        "base-300":"#1e293b",
        info:      "#3abff8",
        success:   "#22c55e",
        warning:   "#f59e0b",
        error:     "#ef4444",
      }
    }],
    darkTheme: "afrovibe",
  },
};