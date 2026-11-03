import type { Metadata } from "next";
import "./globals.css";
import BackgroundMusic from "@/components/BackgroundMusic";
import { PersonaProvider } from "@/lib/usePersona";
import { BRAND } from "@/lib/persona";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: `${BRAND}: a voice-first assistant with your own name, face and voice. It talks in any language, runs your accounts and your computer, and asks before it acts.`,
  applicationName: SITE_NAME,
  publisher: "UNC Team",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/brand/apple-touch-icon.png", sizes: "180x180" },
  },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: SITE_NAME }] },
  twitter: { card: "summary_large_image", images: ["/brand/og-image.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PersonaProvider>{children}</PersonaProvider>
        <BackgroundMusic />
      </body>
    </html>
  );
}
