import type { Metadata } from "next";
import "./globals.css";
import "./subzero-theme.css";
import "./subzero-enhancements.css";

export const metadata: Metadata = {
  title: "Subzero Mail",
  description: "The fast AI inbox you actually own.",
};

const themeBootScript = `
(() => {
  try {
    const stored = localStorage.getItem("subzero-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
