"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { 
  ShieldCheck, 
  Search, 
  ExternalLink, 
  Layers, 
  Settings2, 
  Activity, 
  Globe2, 
  BookOpen,
  User,
  LogIn,
  History,
  Bot
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const { user, openAuthModal, isLoading } = useAuth();

  const navLinks = [
    { name: "Bot Dashboard", href: "/", icon: Activity },
    { name: "Page Analyzer", href: "/analyzer", icon: Layers },
    { name: "URL Inspector", href: "/inspector", icon: Search },
    { name: "Domains & Rules", href: "/domains", icon: Globe2 },
    { name: "Settings", href: "/settings", icon: Settings2 },
  ];

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-slate-900/90 border-b border-slate-800 text-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform duration-200">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                    Justapedia
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Bot Suite
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">MediaWiki 1.45.3 Automated Suite</p>
              </div>
            </Link>
          </div>

          {/* Navigation Links - (Meta is completely removed!) */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-inner"
                      : "text-slate-300 hover:text-white hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Right Status, User Profile & Wiki Shortcut */}
          <div className="flex items-center gap-2 sm:gap-3">
            
            {/* User Account / Contribution Status */}
            {isLoading ? (
              <div className="w-24 h-8 bg-slate-800 rounded-lg animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={openAuthModal}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-emerald-500/40 text-xs text-white transition shadow-sm"
                  title="Click to view account and contributions"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-medium text-emerald-400 font-mono">@{user.username}</span>
                  <span className="hidden sm:inline-block px-1.5 py-0.2 rounded bg-slate-900 text-[10px] text-slate-400 font-mono">
                    {user.editcount ?? 0} edits
                  </span>
                </button>

                <a
                  href={user.userContributionsUrl || `https://justapedia.org/Special:Contributions/${user.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
                  title="View your Justapedia contribution history"
                >
                  <History className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Contributions</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              </div>
            ) : (
              <button
                onClick={openAuthModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/30 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Log In</span>
              </button>
            )}

            {/* Wiki Link */}
            <a
              href="https://justapedia.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
              title="Visit Justapedia Wiki"
            >
              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>Justapedia</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

          </div>

        </div>
      </div>
    </header>
  );
}
