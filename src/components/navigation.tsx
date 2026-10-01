"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const sections = [
  { href: "/dashboard", label: "Overview" },
  { href: "/forecast", label: "Forecast" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/settings", label: "Settings" },
];
export function Navigation() {
  const path = usePathname();
  return <nav aria-label="Main navigation">{sections.map(item => {
    const current = path === item.href || path.startsWith(`${item.href}/`);
    return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>{item.label}</Link>;
  })}</nav>;
}
