import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Subzero Mail",
  description: "The fast AI inbox you actually own.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
