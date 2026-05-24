/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070708",
        surface: "#0f0f11",
        elevated: "#16161a",
        raised: "#1c1c21",
        hairline: "#1f1f25",
        line: "#26262d",
        line2: "#33333c",
        ink: "#fafafa",
        muted: "#c8c8d0",
        dim: "#8e8e98",
        faint: "#56565f",
        pink: {
          50: "#fdf2f8",
          100: "#fce7f3",
          300: "#f9a8d4",
          400: "#f472b6",
          500: "#ec4899",
          600: "#db2777",
          700: "#be185d",
          900: "#831843"
        },
        accent: "#ec4899",
        accentSoft: "rgba(236,72,153,0.12)",
        accentRing: "rgba(236,72,153,0.35)",
        danger: "#f43f5e"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace"
        ]
      },
      letterSpacing: {
        tightish: "-0.01em",
        tighter2: "-0.02em"
      },
      boxShadow: {
        soft: "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4)",
        glow: "0 0 0 1px rgba(236,72,153,0.35), 0 8px 30px -8px rgba(236,72,153,0.25)"
      }
    }
  },
  plugins: []
};
