import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AuthProvider } from "@/context/AuthContext";
import { AuthModal } from "@/components/AuthModal";

export const metadata: Metadata = {
  title: "Justapedia Bot Suite | Multi-Bot Automation & Link Guardian",
  description: "High-speed automated bot suite for Justapedia (MediaWiki 1.45.3) with direct user attribution, Wayback link rot repair, biographical data syncing, and per-bot live activity terminals.",
  keywords: ["Justapedia", "ArchiveBot", "Birth Update Bot", "MediaWiki", "Wayback Machine", "Link rot", "Internet Archive"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen flex flex-col bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
        <AuthProvider>
          <Navbar />
          <AuthModal />
          <main className="flex-1 flex flex-col">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
