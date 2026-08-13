import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              Statecraft
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
