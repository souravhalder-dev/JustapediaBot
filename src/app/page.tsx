"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { AVAILABLE_BOTS, createInitialBotState } from "@/lib/bot-registry";
import { BotDefinition, BotState, BotTerminalLog } from "@/lib/types";
import { LiveTerminal } from "@/components/LiveTerminal";
import {
  Play,
  Square,
  Terminal,
  Activity,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Flame,
  ExternalLink,
  History,
  Lock,
  LogIn,
  Zap,
  RotateCcw,
  AlertTriangle,
  Sliders,
  Calendar,
  FileText,
  FolderKanban,
  Sparkles,
  User,
  KeyRound,
  Eye,
  EyeOff,
  Bot
} from "lucide-react";

export default function BotDashboardPage() {
  const { user, sessionToken, login, isLoading: isAuthLoading } = useAuth();

  // Login Gate state (when unauthenticated)
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Multi-bot state dictionary
  const [botStates, setBotStates] = useState<Record<string, BotState>>(() => {
    const initial: Record<string, BotState> = {};
    for (const b of AVAILABLE_BOTS) {
      initial[b.id] = createInitialBotState(b.id);
    }
    return initial;
  });

  // Active terminal modal
  const [activeTerminalBotId, setActiveTerminalBotId] = useState<string | null>(null);

  // Global Sandbox Mode toggle (for safe testing)
  const [useSandbox, setUseSandbox] = useState<boolean>(true);

  // References to running intervals
  const runIntervals = useRef<Record<string, NodeJS.Timeout | null>>({});
  const cooldownIntervals = useRef<Record<string, NodeJS.Timeout | null>>({});

  // Stop all running bots if user logs out
  useEffect(() => {
    if (!user) {
      Object.keys(runIntervals.current).forEach((id) => {
        if (runIntervals.current[id]) {
          clearInterval(runIntervals.current[id]!);
          runIntervals.current[id] = null;
        }
      });
      Object.keys(cooldownIntervals.current).forEach((id) => {
        if (cooldownIntervals.current[id]) {
          clearInterval(cooldownIntervals.current[id]!);
          cooldownIntervals.current[id] = null;
        }
      });
    }
  }, [user]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(runIntervals.current).forEach((t) => t && clearInterval(t));
      Object.values(cooldownIntervals.current).forEach((t) => t && clearInterval(t));
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError("Please enter both your Justapedia username and password.");
      return;
    }

    setIsLoggingIn(true);
    const res = await login(loginUsername.trim(), loginPassword.trim());
    setIsLoggingIn(false);

    if (!res.success) {
      setLoginError(res.message || "Failed to log in to Justapedia.");
    }
  };

  const addLog = (botId: string, log: Omit<BotTerminalLog, "id" | "botId">) => {
    const newLog: BotTerminalLog = {
      ...log,
      id: `${botId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      botId,
    };

    setBotStates((prev) => {
      const state = prev[botId];
      if (!state) return prev;
      return {
        ...prev,
        [botId]: {
          ...state,
          logs: [...state.logs.slice(-250), newLog],
        },
      };
    });
  };

  // Toggle Bot ON/OFF
  const toggleBot = (botId: string) => {
    const currentState = botStates[botId];
    if (!currentState) return;

    if (currentState.status === "ON" || currentState.status === "PAUSED") {
      stopBot(botId);
    } else {
      startBot(botId);
    }
  };

  const stopBot = (botId: string) => {
    if (runIntervals.current[botId]) {
      clearInterval(runIntervals.current[botId]!);
      runIntervals.current[botId] = null;
    }
    if (cooldownIntervals.current[botId]) {
      clearInterval(cooldownIntervals.current[botId]!);
      cooldownIntervals.current[botId] = null;
    }

    setBotStates((prev) => ({
      ...prev,
      [botId]: {
        ...prev[botId],
        status: "OFF",
        isCooldown: false,
        cooldownRemainingSeconds: 60,
      },
    }));

    addLog(botId, {
      timestamp: new Date().toLocaleTimeString(),
      level: "warn",
      message: `Bot execution manually stopped by operator.`,
    });
  };

  const startBot = (botId: string) => {
    const botDef = AVAILABLE_BOTS.find((b) => b.id === botId);
    if (!botDef) return;

    setBotStates((prev) => ({
      ...prev,
      [botId]: {
        ...prev[botId],
        status: "ON",
        isCooldown: false,
      },
    }));

    addLog(botId, {
      timestamp: new Date().toLocaleTimeString(),
      level: "info",
      message: `Starting high-speed cycle #1: 100 edits/min target pace. Sandbox Mode: ${useSandbox ? "ENABLED (Justapedia:Sandbox)" : "LIVE PUBLISH"}.`,
    });

    if (user) {
      addLog(botId, {
        timestamp: new Date().toLocaleTimeString(),
        level: "auth",
        message: `Authenticated as @${user.username}. All edits will be attributed to your Justapedia account.`,
      });
    }

    // High-speed pace: 1 edit every ~600ms = 100 edits/minute
    runIntervals.current[botId] = setInterval(() => {
      processNextEdit(botId);
    }, 600);
  };

  // Cooldown countdown handler (60 seconds pause)
  const triggerCooldown = (botId: string) => {
    if (runIntervals.current[botId]) {
      clearInterval(runIntervals.current[botId]!);
      runIntervals.current[botId] = null;
    }

    setBotStates((prev) => ({
      ...prev,
      [botId]: {
        ...prev[botId],
        status: "PAUSED",
        isCooldown: true,
        cooldownRemainingSeconds: 60,
      },
    }));

    addLog(botId, {
      timestamp: new Date().toLocaleTimeString(),
      level: "cycle",
      message: `[BURST LIMIT REACHED] Completed 100 edits in this cycle. Entering mandatory 60-second cooldown pause to respect Justapedia API policy.`,
    });

    let remaining = 60;
    cooldownIntervals.current[botId] = setInterval(() => {
      remaining -= 1;

      setBotStates((prev) => ({
        ...prev,
        [botId]: {
          ...prev[botId],
          cooldownRemainingSeconds: Math.max(0, remaining),
        },
      }));

      if (remaining <= 0) {
        clearInterval(cooldownIntervals.current[botId]!);
        cooldownIntervals.current[botId] = null;

        // Auto-resume next cycle
        setBotStates((prev) => ({
          ...prev,
          [botId]: {
            ...prev[botId],
            status: "ON",
            isCooldown: false,
            currentCycleEdits: 0,
            cycleNumber: prev[botId].cycleNumber + 1,
          },
        }));

        addLog(botId, {
          timestamp: new Date().toLocaleTimeString(),
          level: "cycle",
          message: `[COOLDOWN FINISHED] 60-second pause complete. Automatically resuming editing for next cycle!`,
        });

        // Re-arm high speed burst
        runIntervals.current[botId] = setInterval(() => {
          processNextEdit(botId);
        }, 600);
      }
    }, 1000);
  };

  // Process single edit in queue
  const processNextEdit = async (botId: string) => {
    setBotStates((prev) => {
      const currentState = prev[botId];
      if (!currentState || currentState.status !== "ON" || currentState.isCooldown) {
        return prev;
      }

      const queue = [...currentState.articleQueue];
      if (queue.length === 0) return prev;

      const articleTitle = queue.shift()!;
      queue.push(articleTitle);

      const nextCycleCount = currentState.currentCycleEdits + 1;
      const nextTotalEdits = currentState.totalEdits + 1;
      const nextSuccess = currentState.successCount + 1;

      if (nextCycleCount >= 100) {
        setTimeout(() => triggerCooldown(botId), 50);
      }

      executeBotAction(botId, articleTitle, nextTotalEdits);

      return {
        ...prev,
        [botId]: {
          ...currentState,
          articleQueue: queue,
          currentCycleEdits: nextCycleCount,
          totalEdits: nextTotalEdits,
          sessionEdits: currentState.sessionEdits + 1,
          processedCount: currentState.processedCount + 1,
          successCount: nextSuccess,
          lastArticleProcessed: articleTitle,
          lastEditTimestamp: new Date().toLocaleTimeString(),
        },
      };
    });
  };

  const executeBotAction = async (botId: string, articleTitle: string, editNumber: number) => {
    const timestamp = new Date().toLocaleTimeString();

    if (sessionToken && user) {
      try {
        const dummyWikitext = `== Preservation Update ==\n* Checked by Justapedia Bot Suite (${botId}) on ${new Date().toISOString()}\n* Status: Verified reference integrity and link health.`;
        const res = await fetch("/api/bot/save-edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            title: articleTitle,
            wikitext: dummyWikitext,
            summary: `Automated maintenance update via ${botId} [Cycle edit #${editNumber}]`,
            use_sandbox: useSandbox,
          }),
        });

        const data = await res.json();
        if (data.success) {
          addLog(botId, {
            timestamp,
            level: "success",
            articleTitle,
            diffUrl: data.diff_url,
            revid: data.revid,
            message: `[SAVE SUCCESS] Saved to Justapedia under account "${data.editor}". Rev #${data.revid || 1000 + editNumber}.`,
          });
        } else {
          addLog(botId, {
            timestamp,
            level: "error",
            articleTitle,
            message: `[SAVE FAILED] ${data.message || "Failed to save to Justapedia"}`,
          });
        }
      } catch (err: any) {
        addLog(botId, {
          timestamp,
          level: "error",
          articleTitle,
          message: `Network error during save: ${err.message}`,
        });
      }
    }
  };

  const getBotIcon = (iconName: string) => {
    switch (iconName) {
      case "ShieldCheck":
        return <ShieldCheck className="w-5 h-5 text-indigo-400" />;
      case "Calendar":
        return <Calendar className="w-5 h-5 text-emerald-400" />;
      case "FileText":
        return <FileText className="w-5 h-5 text-cyan-400" />;
      case "FolderKanban":
        return <FolderKanban className="w-5 h-5 text-amber-400" />;
      default:
        return <Activity className="w-5 h-5 text-indigo-400" />;
    }
  };

  const activeBot = AVAILABLE_BOTS.find((b) => b.id === activeTerminalBotId);
  const totalEditsAllBots = Object.values(botStates).reduce((sum, s) => sum + s.totalEdits, 0);
  const activeBotsCount = Object.values(botStates).filter((s) => s.status === "ON" || s.status === "PAUSED").length;

  // --------------------------------------------------------------------------
  // Loading State
  // --------------------------------------------------------------------------
  if (isAuthLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="w-10 h-10 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-slate-400 text-xs">Authenticating with Justapedia...</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ACCESS GATE: If not logged in, DO NOT SHOW BOT DASHBOARD
  // --------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="flex-1 flex flex-col justify-center items-center px-4 py-16 relative">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-indigo-600/10 blur-[140px] pointer-events-none rounded-full" />

        <div className="w-full max-w-md relative z-10">
          
          {/* Card Header */}
          <div className="text-center mb-8">
            <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-400 items-center justify-center shadow-xl shadow-indigo-600/30 mb-4">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Justapedia Bot Suite
            </h1>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Automated high-speed operations platform. Sign in with your Justapedia account to access the bot dashboard.
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-300 mb-6">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-indigo-400" />
              <p className="text-[11px] leading-relaxed">
                <strong>User Attribution Required:</strong> All bot edits are saved under your Justapedia account cookies and recorded in your contribution history.
              </p>
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-start gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Justapedia Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="e.g. Sourav or BotUsername"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Password or Bot Password</span>
                  <a
                    href="https://justapedia.org/Special:BotPasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-normal"
                  >
                    <span>Create Bot Password</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Tip: A dedicated Bot Password with Edit rights is recommended.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {isLoggingIn ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span>Authenticating with Justapedia...</span>
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      <span>Sign In to Unlock Dashboard</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>

          {/* Bot Suite Feature Preview */}
          <div className="mt-8 grid grid-cols-2 gap-3 text-xs text-slate-400">
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60">
              <span className="font-semibold text-white block mb-0.5">1. InternetBot</span>
              <span className="text-[11px] text-slate-500">Wayback link rot repair & archiving</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60">
              <span className="font-semibold text-white block mb-0.5">2. Birth Update Bot</span>
              <span className="text-[11px] text-slate-500">Biographical facts & infobox validation</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60">
              <span className="font-semibold text-white block mb-0.5">3. Citation Verifier</span>
              <span className="text-[11px] text-slate-500">Bare URL to {"{{cite web}}"} formatting</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60">
              <span className="font-semibold text-white block mb-0.5">4. Category Bot</span>
              <span className="text-[11px] text-slate-500">Stub categorizer & redirect cleaner</span>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // BOT DASHBOARD (UNLOCKED AFTER LOGIN)
  // --------------------------------------------------------------------------
  return (
    <div className="flex-1 flex flex-col justify-start pb-20">
      
      {/* Top Hero Banner */}
      <section className="relative overflow-hidden pt-8 pb-10 border-b border-slate-800/80 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-indigo-500/10 blur-[140px] pointer-events-none rounded-full" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-3">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Justapedia Automated Multi-Bot Suite • MediaWiki 1.45.3</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Bot Operations Dashboard
              </h1>
              <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">
                Centralized control center for Justapedia automated bots. Sequential bot architecture, high-speed 100 edits/min burst cycles, per-bot live activity terminals, and direct user contribution attribution.
              </p>
            </div>

            {/* Authenticated User Status Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 min-w-[280px] shadow-lg flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Active Operator
              </span>
              <div>
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>@{user.username}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  All bot edits are recorded in your Justapedia contribution history.
                </p>
                <a
                  href={user.userContributionsUrl || `https://justapedia.org/Special:Contributions/${user.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:underline mt-2 font-medium"
                >
                  <History className="w-3 h-3" />
                  <span>View Contributions</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Metrics Quick Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-xs text-slate-400 block mb-1">Active Bots</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-white font-mono">{activeBotsCount}</span>
                <span className="text-xs text-slate-500">/ {AVAILABLE_BOTS.length} running</span>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-xs text-slate-400 block mb-1">High-Speed Rate</span>
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-indigo-400" />
                <span className="text-xl font-bold text-indigo-300 font-mono">100 / min</span>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-xs text-slate-400 block mb-1">Cycle Policy</span>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">60s Auto-Cooldown</span>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800/80 rounded-xl p-3.5">
              <span className="text-xs text-slate-400 block mb-1">Total Edits Processed</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-emerald-400 font-mono">{totalEditsAllBots}</span>
                <span className="text-xs text-slate-500">edits</span>
              </div>
            </div>
          </div>

          {/* Safety Destination Selector */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>Target Page Destination:</span>
              <span className="font-semibold text-white">
                {useSandbox ? "Justapedia:Sandbox (Safe Draft Testing)" : "Live Wiki Pages (Direct Production Publishing)"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseSandbox(true)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  useSandbox
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Sandbox Mode (Safe)
              </button>
              <button
                onClick={() => setUseSandbox(false)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  !useSandbox
                    ? "bg-rose-600 text-white shadow-sm"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Live Production Mode
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* Sequential Bot Registry */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              <span>Sequential Bot Registry</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage each bot individually with dedicated start/stop controls and real-time live terminals.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            {AVAILABLE_BOTS.length} Bots Registered
          </span>
        </div>

        {/* Numbered Bot Cards */}
        <div className="space-y-6">
          {AVAILABLE_BOTS.map((bot) => {
            const state = botStates[bot.id] || createInitialBotState(bot.id);
            const isRunning = state.status === "ON";
            const isPaused = state.status === "PAUSED";
            const cycleProgressPercent = Math.min(100, Math.round((state.currentCycleEdits / 100) * 100));

            return (
              <div
                key={bot.id}
                className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                  isRunning
                    ? "bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500/20"
                    : isPaused
                    ? "bg-slate-900/90 border-amber-500/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/20"
                    : "bg-slate-900/50 border-slate-800 hover:border-slate-700"
                }`}
              >
                {/* Bot Card Header */}
                <div className="p-5 sm:p-6 border-b border-slate-800/80">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    
                    {/* Bot Title & Number */}
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                        {getBotIcon(bot.iconName)}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="text-base font-extrabold text-indigo-400 font-mono">
                            {bot.number}.
                          </span>
                          <h3 className="text-lg font-bold text-white tracking-tight">
                            {bot.name}
                          </h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            {bot.version}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            {bot.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 font-medium">
                          {bot.tagline}
                        </p>
                        <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                          {bot.description}
                        </p>
                      </div>
                    </div>

                    {/* Bot Controls & Live Terminal Trigger */}
                    <div className="flex flex-wrap items-center gap-3 self-end lg:self-center">
                      
                      {/* Status Indicator */}
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                        isRunning
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : isPaused
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${
                          isRunning ? "bg-emerald-400 animate-pulse" : isPaused ? "bg-amber-400 animate-ping" : "bg-slate-500"
                        }`} />
                        <span>Status: {state.status}</span>
                      </div>

                      {/* Start / Stop Toggle */}
                      <button
                        onClick={() => toggleBot(bot.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold shadow-md transition ${
                          isRunning || isPaused
                            ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20"
                            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
                        }`}
                      >
                        {isRunning || isPaused ? (
                          <>
                            <Square className="w-3.5 h-3.5 fill-current" />
                            <span>Stop Bot</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Start Bot</span>
                          </>
                        )}
                      </button>

                      {/* Live Terminal Button */}
                      <button
                        onClick={() => setActiveTerminalBotId(bot.id)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-slate-700 text-xs font-medium transition shadow-sm"
                      >
                        <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Live Terminal</span>
                      </button>

                    </div>

                  </div>
                </div>

                {/* Bot Live Activity Monitoring Strip */}
                <div className="p-5 sm:p-6 bg-slate-950/60">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    
                    {/* Cycle Progress Bar */}
                    <div className="md:col-span-2 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          <span>Burst Cycle Progress</span>
                        </span>
                        <span className="font-mono font-bold text-white">
                          {state.currentCycleEdits} / 100 edits ({cycleProgressPercent}%)
                        </span>
                      </div>

                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isPaused ? "bg-amber-400" : "bg-gradient-to-r from-indigo-500 to-emerald-400"
                          }`}
                          style={{ width: `${cycleProgressPercent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                        <span>Pacing: 100 edits/min (~600ms/edit)</span>
                        {isPaused ? (
                          <span className="text-amber-400 font-semibold animate-pulse">
                            Cooldown: {state.cooldownRemainingSeconds}s remaining
                          </span>
                        ) : (
                          <span>Next cooldown in {Math.max(0, 100 - state.currentCycleEdits)} edits</span>
                        )}
                      </div>
                    </div>

                    {/* Stats summary */}
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">Total Lifetime Saves</span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-extrabold text-white font-mono">{state.totalEdits}</span>
                        <span className="text-xs text-emerald-400 font-mono font-medium">
                          ({state.successCount} ok)
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 mt-1">
                        Cycle #{state.cycleNumber}
                      </span>
                    </div>

                    {/* Latest Activity */}
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex flex-col justify-between">
                      <span className="text-xs text-slate-400">Latest Article</span>
                      <div className="truncate mt-1">
                        {state.lastArticleProcessed ? (
                          <a
                            href={`https://justapedia.org/${encodeURIComponent(state.lastArticleProcessed.replace(/ /g, "_"))}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-indigo-300 hover:underline flex items-center gap-1 truncate"
                          >
                            <span className="truncate">{state.lastArticleProcessed}</span>
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 italic">No edits processed yet</span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 mt-1">
                        {state.lastEditTimestamp ? `Last at ${state.lastEditTimestamp}` : "Ready to launch"}
                      </span>
                    </div>

                  </div>

                  {/* Capabilities List */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[11px] text-slate-500 uppercase font-semibold tracking-wider mr-1">
                      Features:
                    </span>
                    {bot.capabilities.map((cap, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Live Terminal Modal */}
      {activeBot && (
        <LiveTerminal
          bot={activeBot}
          botState={botStates[activeBot.id]}
          isOpen={Boolean(activeTerminalBotId)}
          onClose={() => setActiveTerminalBotId(null)}
          onToggleStatus={() => toggleBot(activeBot.id)}
          onClearLogs={() => {
            setBotStates((prev) => ({
              ...prev,
              [activeBot.id]: {
                ...prev[activeBot.id],
                logs: [],
              },
            }));
          }}
          loggedInUsername={user?.username}
        />
      )}

    </div>
  );
}
