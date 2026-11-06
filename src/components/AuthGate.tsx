"use client";

import React from "react";
import { Lock, LogIn, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface AuthGateProps {
  title?: string;
  description?: string;
}

export function AuthGate({
  title = "Authentication Required",
  description = "All bot functions, analysis tools, dashboards, and settings are strictly restricted to authenticated Justapedia users holding Bot or Administrator privileges.",
}: AuthGateProps) {
  const { openAuthModal } = useAuth();

  return (
    <div className="flex-1 w-full bg-slate-950 flex items-center justify-center py-20 px-4">
      <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-6 shadow-2xl animate-in fade-in duration-300">
        <div className="relative w-16 h-16 mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Lock className="w-8 h-8" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-indigo-600 border-2 border-slate-900 flex items-center justify-center text-white">
            <ShieldAlert className="w-3.5 h-3.5" />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Security Policy Enforced
          </span>
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-left text-xs space-y-2 text-slate-300">
          <div className="flex items-center gap-2 font-medium text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Authorized Privilege Levels:</span>
          </div>
          <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-1 pl-1 font-mono">
            <li>Bot Accounts (<code className="text-indigo-300">bot</code>, <code className="text-indigo-300">copyviobot</code>)</li>
            <li>Administrators (<code className="text-indigo-300">sysop</code>, <code className="text-indigo-300">bureaucrat</code>)</li>
          </ul>
        </div>

        <button
          onClick={openAuthModal}
          className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-900/40 flex items-center justify-center gap-2 group"
        >
          <LogIn className="w-4 h-4 group-hover:scale-110 transition-transform" />
          <span>Log In with Justapedia Account</span>
        </button>

        <p className="text-[11px] text-slate-500">
          Direct access to bot features without authentication is prohibited.
        </p>
      </div>
    </div>
  );
}
