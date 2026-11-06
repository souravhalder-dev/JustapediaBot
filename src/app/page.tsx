"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getActiveBots } from "@/lib/bot-registry";
import {
  ShieldCheck,
  Play,
  Square,
  ArrowRight,
  Flame,
  Clock,
  Sparkles,
  Lock,
  ExternalLink,
  Bot,
  Activity,
  CheckCircle2,
  Calendar,
  Layers,
  LogIn,
  ShieldAlert,
  KeyRound,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

function HomeContent() {
  const { user, sessionToken, openAuthModal, isLoading } = useAuth();
  const searchParams = useSearchParams();
  const authQuery = searchParams.get("auth");
  const activeBots = getActiveBots();

  // Live status for InternetArchiveBot (only polled when authenticated)
  const [runnerState, setRunnerState] = useState<{
    status: "RUNNING" | "PAUSED" | "STOPPED";
    currentCycleEdits: number;
    cycleNumber: number;
    totalEdits: number;
    totalChecked: number;
    cooldownRemainingSeconds: number;
  }>({
    status: "STOPPED",
    currentCycleEdits: 0,
    cycleNumber: 1,
    totalEdits: 0,
    totalChecked: 0,
    cooldownRemainingSeconds: 0,
  });

  const [isToggling, setIsToggling] = useState(false);

  // Poll server state ONLY when authenticated with Bot or Admin rights
  useEffect(() => {
    if (!user || !sessionToken || (!user.is_bot && !user.is_admin)) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/bot/status?botId=internet-bot", {
          headers: { Authorization: `Bearer ${sessionToken}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setRunnerState({
            status: data.status,
            currentCycleEdits: data.currentCycleEdits,
            cycleNumber: data.cycleNumber,
            totalEdits: data.totalEdits,
            totalChecked: data.totalChecked,
            cooldownRemainingSeconds: data.cooldownRemainingSeconds || 0,
          });
        }
      } catch {
        // ignore
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, 1500);
    return () => clearInterval(timer);
  }, [user, sessionToken]);

  const handleQuickToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user || !sessionToken) {
      openAuthModal();
      return;
    }

    setIsToggling(true);
    try {
      const isCurrentlyRunning = runnerState.status === "RUNNING" || runnerState.status === "PAUSED";
      const action = isCurrentlyRunning ? "stop" : "start";

      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ action, botId: "internet-bot" }),
      });
      const data = await res.json();
      if (data.state) {
        setRunnerState({
          status: data.state.status,
          currentCycleEdits: data.state.currentCycleEdits,
          cycleNumber: data.state.cycleNumber,
          totalEdits: data.state.totalEdits,
          totalChecked: data.state.totalChecked,
          cooldownRemainingSeconds: data.state.cooldownRemainingSeconds || 0,
        });
      }
    } catch (err) {
      console.error("Toggle error:", err);
    } finally {
      setIsToggling(false);
    }
  };

  const isRunning = runnerState.status === "RUNNING";
  const isPaused = runnerState.status === "PAUSED";
  const isStopped = runnerState.status === "STOPPED";

  // Loading skeleton while verifying session
  if (isLoading) {
    return (
      <div className="flex-1 w-full bg-slate-950 flex items-center justify-center py-28 text-slate-400">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
          <span>Verifying security permissions...</span>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STATE A: Unauthenticated or Unauthorized (All bot features completely hidden)
  // --------------------------------------------------------------------------
  if (!user || (!user.is_bot && !user.is_admin)) {
    return (
      <div className="flex-1 w-full bg-slate-950 text-slate-100 py-16 px-4">
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
          
          {/* Security Notice Alert if redirected */}
          {authQuery && (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-3 shadow-lg">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <strong className="block font-semibold">
                  {authQuery === "expired"
                    ? "Session Expired"
                    : authQuery === "forbidden"
                    ? "Access Denied: Insufficient Privileges"
                    : "Authentication Required"}
                </strong>
                <span>
                  {authQuery === "expired"
                    ? "Your Justapedia login session has expired. Please sign in again with your Bot or Administrator account."
                    : authQuery === "forbidden"
                    ? "Only Justapedia accounts with Bot or Administrator rights are authorized to access this suite."
                    : "You must be logged in with a Justapedia Bot or Administrator account to access the requested bot dashboard."}
                </span>
              </div>
            </div>
          )}

          {/* Secure Restricted Portal Banner */}
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border border-slate-800 shadow-2xl text-center space-y-8 relative overflow-hidden">
            {/* Top Glow Accent */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-32 bg-indigo-500/10 blur-3xl pointer-events-none" />

            {/* Lock Emblem */}
            <div className="relative inline-flex">
              <div className="w-20 h-20 rounded-3xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-950/50">
                <Lock className="w-10 h-10" />
              </div>
              <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center text-slate-950">
                <KeyRound className="w-4 h-4" />
              </div>
            </div>

            {/* Headline */}
            <div className="space-y-3 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Restricted Access &bull; Justapedia Automated Bot Suite</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
                Authentication Required
              </h1>
              <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                Before logging in, all bot operations, live execution terminals, processing queues, and configuration controls remain completely hidden to preserve encyclopedia integrity.
              </p>
            </div>

            {/* Login CTA Button */}
            <div className="pt-2 max-w-sm mx-auto">
              <button
                onClick={openAuthModal}
                className="w-full py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow-xl shadow-indigo-900/40 hover:shadow-indigo-900/60 flex items-center justify-center gap-2.5 group"
              >
                <LogIn className="w-5 h-5 group-hover:scale-110 transition-transform" />
                <span>Log In with Justapedia Account</span>
              </button>
              <p className="text-[11px] text-slate-500 mt-2.5">
                Authenticates directly against Justapedia MediaWiki Action API
              </p>
            </div>

            {/* Security Pillars Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-slate-800 text-left">
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Strict RBAC</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Restricted exclusively to users with verified <code className="text-indigo-300">bot</code> or <code className="text-indigo-300">sysop</code> / <code className="text-indigo-300">bureaucrat</code> rights.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  <span>Signed JWT Sessions</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Stateless cryptographic authentication tokens verified by server-side Edge middleware on every request.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-white">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <span>Shielded Backend</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  All backend API routes, bot controls, and queues are protected against direct or unauthorized calls.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // STATE B: Authenticated & Authorized Operator (Display Bot Portal)
  // --------------------------------------------------------------------------
  return (
    <div className="flex-1 w-full bg-slate-950 text-slate-100 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* Operator Welcome Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Authorized Operator Session Active</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Active Justapedia Bots
            </h2>
            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              Select a bot below to open its dedicated dashboard, monitor live progress, inspect article history, and manage background operations.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-0.5">
              <span className="text-slate-400 block text-[10px] uppercase font-mono">Operator</span>
              <div className="flex items-center gap-1.5 font-bold text-white">
                <span className="text-emerald-400 font-mono">@{user.username}</span>
                {user.role_badge && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                    {user.role_badge}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bot Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeBots.map((bot) => (
            <div
              key={bot.id}
              className="group relative rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 shadow-xl hover:shadow-2xl hover:shadow-indigo-950/30 transition-all duration-300 flex flex-col justify-between overflow-hidden"
            >
              {/* Card Top Accent */}
              <div className="h-1.5 w-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400" />

              <div className="p-6 space-y-5">
                {/* Title & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition">
                        {bot.name}
                      </h3>
                      <span className="text-[11px] text-slate-400 block font-mono">
                        {bot.version} &bull; {bot.category}
                      </span>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${
                      isRunning
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : isPaused
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                        : "bg-slate-800 border-slate-700 text-slate-400"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isRunning
                          ? "bg-emerald-400 animate-ping"
                          : isPaused
                          ? "bg-amber-400 animate-pulse"
                          : "bg-slate-500"
                      }`}
                    />
                    <span>
                      {isRunning
                        ? "RUNNING"
                        : isPaused
                        ? `PAUSED (${runnerState.cooldownRemainingSeconds}s)`
                        : "STOPPED"}
                    </span>
                  </div>
                </div>

                {/* Description */}
                <p className="text-slate-300 text-xs leading-relaxed line-clamp-3">
                  {bot.description}
                </p>

                {/* Quick Metrics */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Total Edits</span>
                    <span className="font-bold text-white font-mono text-sm">{runnerState.totalEdits}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Checked</span>
                    <span className="font-bold text-indigo-300 font-mono text-sm">{runnerState.totalChecked}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block uppercase font-medium">Cycle Edits</span>
                    <span className="font-bold text-emerald-400 font-mono text-sm">
                      {runnerState.currentCycleEdits}/100
                    </span>
                  </div>
                </div>

                {/* Quick Info Bar */}
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Cycle #{runnerState.cycleNumber} (100 edits + 60s pause)</span>
                  </span>
                </div>
              </div>

              {/* Action Footer */}
              <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between gap-3">
                <button
                  onClick={handleQuickToggle}
                  disabled={isToggling}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                    isRunning || isPaused
                      ? "bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30"
                      : "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30"
                  }`}
                  title={isRunning || isPaused ? "Stop Bot" : "Start Bot"}
                >
                  {isRunning || isPaused ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Start</span>
                    </>
                  )}
                </button>

                <Link
                  href={bot.route || `/bots/${bot.id}`}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-900/30 group-hover:shadow-indigo-900/50"
                >
                  <span>Open Dedicated Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          ))}

          {/* Scalable Placeholder Card for Future Bots */}
          <div className="rounded-2xl border-2 border-dashed border-slate-800/80 p-6 flex flex-col items-center justify-center text-center space-y-3 min-h-[320px]">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-300">More Bots Coming Soon</h4>
              <p className="text-xs text-slate-500 max-w-[220px] mt-1 leading-relaxed">
                Modular architecture ready for Birth Update Bot, Citation Verifier Bot, and Category Maintenance Bot.
              </p>
            </div>
            <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800">
              Extensible Framework
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 w-full bg-slate-950 flex items-center justify-center py-28 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
