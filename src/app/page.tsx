"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
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
} from "lucide-react";

export default function HomePage() {
  const { user, sessionToken, openAuthModal } = useAuth();
  const activeBots = getActiveBots();

  // Live status for InternetArchiveBot
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

  // Poll server state
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/bot/status?botId=internet-bot", { cache: "no-store" });
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
  }, []);

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

  return (
    <div className="flex-1 w-full bg-slate-950 text-slate-100 py-10">
      {/* Hero Welcome */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Autonomous Server-Side Execution &bull; 24/7/365 Continuous Operation</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Active Justapedia Bots
          </h2>
          <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
            Select a bot below to open its dedicated dashboard, monitor live progress, inspect article history, and control server operations.
          </p>
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
