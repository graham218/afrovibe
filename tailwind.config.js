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
      colors: {
        "brand-start": "#FF6B6B",
        "brand-end":   "#FECA57",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial"],
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
    themes: [
      "light",
      "dark",
      {
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
        },
      },
    ],
  },
};
