import type { Config } from "tailwindcss";

// Apple's SF Pro leads; -apple-system + BlinkMacSystemFont resolve to the real
// iOS/macOS system font (and auto-pick SF Pro Display vs Text by size). Inter is
// self-hosted via next/font as `--font-body` for non-Apple/non-Android web.
const NATIVE_STACK = [
  "-apple-system",
  "BlinkMacSystemFont",
  '"SF Pro Display"',
  '"SF Pro Text"',
  "system-ui",
  '"Segoe UI"',
  "Roboto",
  "sans-serif",
];

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens. Channel-triplet vars (in globals.css) + the
        // `<alpha-value>` placeholder let every utility take an /opacity modifier.
        surface: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          raised: "rgb(var(--surface-raised-rgb) / <alpha-value>)",
          inset: "rgb(var(--surface-inset-rgb) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink-rgb) / <alpha-value>)",
          muted: "rgb(var(--ink-muted-rgb) / <alpha-value>)",
          faint: "rgb(var(--ink-faint-rgb) / <alpha-value>)",
        },
        line: "var(--line)",
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          soft: "var(--accent-soft)",
          strong: "rgb(var(--accent-strong-rgb) / <alpha-value>)",
          ink: "rgb(var(--accent-ink-rgb) / <alpha-value>)",
        },
        // Expressive-only accent (energy). NEVER used to encode status.
        energy: {
          DEFAULT: "rgb(var(--energy-rgb) / <alpha-value>)",
          soft: "var(--energy-soft)",
          strong: "rgb(var(--energy-strong-rgb) / <alpha-value>)",
        },
        "line-strong": "var(--line-strong)",
        ok: "rgb(var(--ok-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        bad: "rgb(var(--bad-rgb) / <alpha-value>)",
      },
      fontFamily: {
        // Native-first system stack: SF Pro on Apple (via -apple-system, no
        // download), Roboto on Android, self-hosted Inter (--font-body) as the
        // polished web fallback. One family everywhere — weight + size carry the
        // hierarchy, so `display` and `sans` share the same stack.
        sans: NATIVE_STACK,
        display: NATIVE_STACK,
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        raised: "0 1px 2px 0 rgba(20,28,18,0.04), 0 14px 30px -18px rgba(20,28,18,0.18)",
        pop: "0 2px 4px 0 rgba(20,28,18,0.05), 0 22px 44px -22px rgba(20,28,18,0.28)",
        hero: "0 2px 6px 0 rgba(20,28,18,0.05), 0 30px 60px -30px rgba(20,28,18,0.3)",
        glow: "0 0 0 1px var(--accent-soft), 0 0 28px -6px var(--accent-soft)",
      },
      keyframes: {
        "rise": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "ring-fill": {
          "0%": { strokeDashoffset: "var(--ring-circumference)" },
        },
        "sheet-up": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "ring-fill": "ring-fill 1.1s cubic-bezier(0.22,1,0.36,1) both",
        "sheet-up": "sheet-up 0.32s cubic-bezier(0.22,1,0.36,1) both",
        "fade-in": "fade-in 0.2s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
