import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Vazirmatn", "Tahoma", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          // Enterprise blue (the logo's): white text on 600 is 6.4:1.
          50: "#eef5fc",
          100: "#d6e7f8",
          200: "#aecdf0",
          300: "#7eaee5",
          400: "#4b8bd8",
          500: "#2370cc",
          600: "#0a5fb4",
          700: "#084c91",
          800: "#0a3d72",
          900: "#0b2f55",
        },
      },
    },
  },
  plugins: [],
};

export default config;
