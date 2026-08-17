import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Statecraft",
  description:
    "Extracts deadlines from legislation. Every date traces to quoted source text and cites the statute that computed it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body className={`${publicSans.className} min-h-screen antialiased`}>
        {children}
      </body>
    </html>
  );
}
