"use client";
import { useEffect, useRef } from "react";
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
  const nav = useRef<HTMLElement>(null);
  // On narrow screens the menu scrolls sideways; keep the current section in view. Only the menu is
  // scrolled: scrollIntoView would also move the browser's keyboard starting point onto the link,
  // so the first Tab would skip past "Skip to content".
  useEffect(() => {
    const menu = nav.current;
    const active = menu?.querySelector('[aria-current="page"]');
    if (!menu || !active) return;
    const menuBox = menu.getBoundingClientRect();
    const linkBox = active.getBoundingClientRect();
    if (linkBox.right > menuBox.right) menu.scrollLeft += linkBox.right - menuBox.right;
    else if (linkBox.left < menuBox.left) menu.scrollLeft -= menuBox.left - linkBox.left;
  }, [path]);
  return <nav ref={nav} aria-label="Main navigation">{sections.map(item => {
    const current = path === item.href || path.startsWith(`${item.href}/`);
    return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>{item.label}</Link>;
  })}</nav>;
}
