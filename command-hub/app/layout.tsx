import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "9 — Command Hub",
  description: "9 Enterprises Command Hub — Owner-facing operations dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="max-w-screen-xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
