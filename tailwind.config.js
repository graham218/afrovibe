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
        // Body up a notch, comfy line-heights
        xs: ['12px', '1.5'],
        sm: ['13px', '1.6'],
        base: ['16px', '1.65'],  // default body
        lg: ['18px', '1.5'],
        xl: ['20px', '1.4'],
        '2xl': ['24px', '1.3'],
        '3xl': ['30px', '1.2'],
        '4xl': ['36px', '1.15'],
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
        "base-100":"#ffffff",
        "base-200":"#f3f6fa",
        "base-300":"#e6ecf2",
        info:      "#3abff8",
        success:   "#22c55e",
        warning:   "#f59e0b",
        error:     "#ef4444",
      }
    }]
  }
};
