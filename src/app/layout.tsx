import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StudyRoom",
  description: "Realtime collaborative study rooms (YouTube sync)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="antialiased">
        <div className="nt-page">{children}</div>
      </body>
    </html>
  );
}
