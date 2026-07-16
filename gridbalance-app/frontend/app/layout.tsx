import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { DISCLAIMER } from "@/lib/contracts";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "GridBalance AI Morocco",
    template: "%s · GridBalance AI Morocco",
  },
  description:
    "Orchestrateur de flexibilite du reseau electrique pour les journees sans vent. " +
    DISCLAIMER,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#040e1b" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Rejoue le theme memorise AVANT le premier rendu : sans ce script, la page
 * s'afficherait en sombre (le defaut du SSR) puis basculerait en clair — un
 * flash visible a chaque navigation.
 */
const antiFlash = `(function(){try{var t=localStorage.getItem("gridbalance-theme");if(t==="light")document.documentElement.classList.remove("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
