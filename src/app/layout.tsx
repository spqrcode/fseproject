import type { Metadata } from "next";
// Fonts are self-hosted from npm packages, so browsing the app makes no requests to a third-party font service.
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
export const metadata: Metadata = { title: { default: "FinTwin Global", template: "%s · FinTwin Global" }, description: "FinTwin Global, a financial twin built for the Financial Software Engineering course." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a href="#main" className="skip-link">Skip to content</a>{children}</body></html>;
}
