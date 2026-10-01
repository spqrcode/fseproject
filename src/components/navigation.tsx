"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Navigation() {
  const path = usePathname();
  return <nav aria-label="Main navigation">{[{ href: "/dashboard", label: "Overview" }, { href: "/portfolio", label: "Portfolio" }].map(item => <Link key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>;
}
