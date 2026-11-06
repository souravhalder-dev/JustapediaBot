"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { 
  Bot, 
  ExternalLink, 
  LogIn, 
  LogOut, 
  History, 
  BookOpen, 
  ShieldCheck,
  Lock
} from "lucide-react";

export function Navbar() {
  const { user, openAuthModal, logout, isLoading } = useAuth();

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
                <p className="text-[11px] text-slate-400">MediaWiki 1.45.3 Automated Operations</p>
              </div>
            </Link>
          </div>

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
                  className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700 hover:text-white border border-slate-700 transition"
                  title="View your Justapedia contribution history"
                >
                  <History className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Contributions</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>

                <button
                  onClick={logout}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                  title="Log out of Justapedia"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-semibold">
                  <Lock className="w-3 h-3" />
                  <span>Restricted Access</span>
                </span>
                <button
                  onClick={openAuthModal}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/30 transition"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Log In</span>
                </button>
              </div>
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
              <span>Justapedia.org</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>

          </div>

        </div>
      </div>
    </header>
  );
}
