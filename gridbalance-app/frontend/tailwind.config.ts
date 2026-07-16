import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1440px" },
    },
    extend: {
      colors: {
        /* Charte GridBalance AI Morocco.
         *
         * Les SURFACES sont pilotees par variables CSS : elles basculent entre
         * clair et sombre (voir globals.css, :root vs .dark). `<alpha-value>`
         * preserve les opacites du type `bg-base-900/80`.
         */
        base: {
          DEFAULT: "hsl(var(--base-900) / <alpha-value>)",
          900: "hsl(var(--base-900) / <alpha-value>)", // fond de page
          800: "hsl(var(--base-800) / <alpha-value>)", // surface des cartes
          700: "hsl(var(--base-700) / <alpha-value>)",
          600: "hsl(var(--base-600) / <alpha-value>)",
        },

        /* Encre FIXE, jamais inversee : texte/icone pose sur un aplat emeraude.
         * L'emeraude reste identique dans les deux themes, donc son texte aussi
         * (sinon on perdrait le contraste en mode clair). */
        ink: "#040e1b",

        /* Filet : bordures et voiles subtils. Blanc sur fond sombre, encre sur
         * fond clair -> les 100+ `border-hairline/[0.07]` suivent le theme. */
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        emerald: {
          DEFAULT: "#17c884",
          50: "#e7fbf3",
          100: "#c6f4e2",
          200: "#8fe9c6",
          300: "#57dda9",
          400: "#2ed095",
          500: "#17c884",
          600: "#12a56c",
          700: "#0e7f53",
          800: "#0a583a",
          900: "#063724",
        },

        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /* Statuts */
        ok: "#17c884",
        warn: "#f5a524",
        danger: "#ef4d59",
        info: "#38bdf8",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(23,200,132,0.25), 0 8px 30px -12px rgba(23,200,132,0.35)",
        // Suit le theme : ombre portee franche en clair, profonde en sombre.
        panel: "var(--shadow-panel)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.25s ease-out",
        shimmer: "shimmer 1.6s infinite",
        "pulse-dot": "pulse-dot 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
