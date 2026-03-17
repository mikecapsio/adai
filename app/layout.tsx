import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Art Director AI",
  description: "A live AI art director for 3D game assets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
