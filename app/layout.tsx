import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memo AI — Meeting notes, ready in minutes",
  description: "A focused workspace for recordings, transcripts, AI notes, and action items.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
