import type { Metadata } from "next";
import { JetBrains_Mono, Reddit_Sans } from "next/font/google";
import "./globals.css";

const redditSans = Reddit_Sans({
  variable: "--font-nt-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-nt-mono",
  subsets: ["latin"],
});

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
      <body
        suppressHydrationWarning
        className={`${redditSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <div className="nt-page">{children}</div>
      </body>
    </html>
  );
}
