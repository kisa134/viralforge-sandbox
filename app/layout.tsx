import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViralForge — CPA Chat OS (sandbox)",
  description: "Offer-first chat sandbox for ViralForge CPA creators",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
