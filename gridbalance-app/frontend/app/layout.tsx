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
  themeColor: "#040e1b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
