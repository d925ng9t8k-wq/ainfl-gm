"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Mission Control", href: "/mission-control" },
  { label: "Companies",       href: "/companies" },
  { label: "Draft Room",      href: "/draft-room" },
  { label: "Roster",          href: "/roster" },
  { label: "Log",             href: "/log" },
] as const;

export default function Nav() {
  const pathname = usePathname();

  return (
    <header
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
      }}
      className="sticky top-0 z-50"
    >
      <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center gap-8">
        {/* Wordmark */}
        <Link
          href="/mission-control"
          className="text-2xl font-bold tracking-widest glow-cyan"
          style={{ color: "var(--accent-cyan)", textDecoration: "none" }}
        >
          9
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: active ? "var(--accent-cyan)" : "var(--text-secondary)",
                  borderBottom: active ? "2px solid var(--accent-cyan)" : "2px solid transparent",
                  textDecoration: "none",
                  fontSize: "0.75rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 12px",
                  transition: "color 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Status indicator — far right */}
        <div className="ml-auto flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full dot-green"
            style={{ display: "inline-block" }}
            title="9 is online"
          />
          <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
            9 ONLINE
          </span>
        </div>
      </div>
    </header>
  );
}
