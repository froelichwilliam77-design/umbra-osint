/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07080c",
          900: "#0c0e14",
          800: "#12151d",
          700: "#1a1e29",
          600: "#242a38",
        },
        fog: {
          100: "#e8e6e1",
          300: "#b8b4ab",
          500: "#7c786f",
        },
        signal: {
          found: "#5ee0a8",
          miss: "#6b7280",
          blocked: "#f5a524",
          escalate: "#c084fc",
          error: "#f07178",
          invalid: "#94a3b8",
        },
        accent: {
          DEFAULT: "#8b7cf7",
          dim: "#5b4fd1",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(139, 124, 247, 0.08), 0 18px 50px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
