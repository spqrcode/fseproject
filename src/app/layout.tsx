import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Portfolio Risk Dashboard", template: "%s · Portfolio Risk Dashboard" }, description: "A university portfolio management project." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a href="#main" className="skip-link">Skip to content</a>{children}</body></html>;
}
