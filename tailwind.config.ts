import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: "#FAF6EF",
        cream: "#F2EADA",
        sand: "#E7DBC6",
        ink: "#241B2E",
        muted: "#6B6175",
        emerald: { DEFAULT: "#0F5C4D", dark: "#0A4034", light: "#2E8573", mist: "#E6F0ED" },
        gold: { DEFAULT: "#C8A24C", light: "#E2C887", dark: "#A07E2E" },
        rose: { DEFAULT: "#B0506A", light: "#E7C9D2" },
        wine: "#6E2238",
        diva: { rose: "#B0506A", gold: "#C8A24C", ink: "#241B2E", cream: "#FAF6EF" },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', "Georgia", "serif"],
        body: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        luxe: "0 10px 40px -12px rgba(36,27,46,0.18)",
        card: "0 6px 24px -10px rgba(36,27,46,0.16)",
        gold: "0 8px 30px -8px rgba(200,162,76,0.35)",
      },
      keyframes: {
        fadeUp: { "0%": { opacity: "0", transform: "translateY(18px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        marquee: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        pop: { "0%": { transform: "scale(0.9)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        spinSlow: { to: { transform: "rotate(360deg)" } },
        slideInRight: { "0%": { transform: "translateX(100%)" }, "100%": { transform: "translateX(0)" } },
      },
      animation: {
        fadeUp: "fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) both",
        fadeIn: "fadeIn 0.8s ease both",
        float: "float 5s ease-in-out infinite",
        marquee: "marquee 24s linear infinite",
        shimmer: "shimmer 2.5s linear infinite",
        pop: "pop 0.35s cubic-bezier(0.16,1,0.3,1) both",
        spinSlow: "spinSlow 14s linear infinite",
        slideInRight: "slideInRight 0.25s ease both",
      },
    },
  },
  plugins: [],
} satisfies Config;
