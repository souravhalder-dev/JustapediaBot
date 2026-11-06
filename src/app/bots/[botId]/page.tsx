"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { AVAILABLE_BOTS } from "@/lib/bot-registry";
import {
  Play,
  Square,
  RefreshCw,
  Terminal,
  History,
  ListOrdered,
  Settings as SettingsIcon,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  Plus,
  Trash2,
  Clock,
  Flame,
  ArrowLeft,
  Search,
  Lock,
  Layers,
  Sparkles,
  RotateCcw,
  Sliders,
  Check,
} from "lucide-react";

export default function BotDedicatedDashboard() {
  const params = useParams();
  const router = useRouter();
  const botId = (params?.botId as string) || "internet-bot";
  const { user, sessionToken, openAuthModal } = useAuth();

  const botDef = AVAILABLE_BOTS.find((b) => b.id === botId) || AVAILABLE_BOTS[0];

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<"terminal" | "history" | "queue" | "settings">("terminal");

  // Server-synced state
  const [runnerState, setRunnerState] = useState<{
    status: "RUNNING" | "PAUSED" | "STOPPED";
    currentCycleEdits: number;
    cycleNumber: number;
    pauseUntil: number | null;
    cooldownRemainingSeconds: number;
    totalEdits: number;
    totalChecked: number;
    totalSkipped: number;
    totalErrors: number;
    queue: string[];
    options: {
      useSandbox: boolean;
      archiveWorkingLinks: boolean;
      repairBrokenArchives: boolean;
      tagUnrecoverableDead: boolean;
      maxLinksPerPage: number;
      categoryInput: string;
    };
    detailedStats: {
      articlesProcessed: number;
      referencesChecked: number;
      deadLinksDetected: number;
      archiveLinksAdded: number;
      archiveLinksRepaired: number;
      newSnapshotsRequested: number;
      unrecoverableLinksTagged: number;
      articlesModified: number;
      failedOperations: number;
    };
    logs: Array<{
      id: string;
      timestamp: string;
      level: "info" | "success" | "warn" | "error" | "cycle";
      articleTitle?: string;
      message: string;
      diffUrl?: string;
    }>;
  }>({
    status: "STOPPED",
    currentCycleEdits: 0,
    cycleNumber: 1,
    pauseUntil: null,
    cooldownRemainingSeconds: 0,
    totalEdits: 0,
    totalChecked: 0,
    totalSkipped: 0,
    totalErrors: 0,
    queue: [],
    options: {
      useSandbox: false,
      archiveWorkingLinks: false,
      repairBrokenArchives: true,
      tagUnrecoverableDead: true,
      maxLinksPerPage: 12,
      categoryInput: "Category:All articles with dead external links",
    },
    detailedStats: {
      articlesProcessed: 0,
      referencesChecked: 0,
      deadLinksDetected: 0,
      archiveLinksAdded: 0,
      archiveLinksRepaired: 0,
      newSnapshotsRequested: 0,
      unrecoverableLinksTagged: 0,
      articlesModified: 0,
      failedOperations: 0,
    },
    logs: [],
  });

  // Action status / in-flight states
  const [isControlling, setIsControlling] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Manual article input
  const [customArticleInput, setCustomArticleInput] = useState("");
  const [isAddingArticle, setIsAddingArticle] = useState(false);

  // History tab state
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Options edit state
  const [editedOptions, setEditedOptions] = useState(runnerState.options);

  // Sync editedOptions when runnerState options change
  useEffect(() => {
    setEditedOptions(runnerState.options);
  }, [runnerState.options]);

  // Terminal container scroll ref (contained inside the terminal, never scrolling the main page)
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // 1. Live Server Runner Polling
  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/bot/status?botId=${botId}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRunnerState((prev) => ({
          ...prev,
          status: data.status,
          currentCycleEdits: data.currentCycleEdits,
          cycleNumber: data.cycleNumber,
          pauseUntil: data.pauseUntil,
          cooldownRemainingSeconds: data.cooldownRemainingSeconds,
          totalEdits: data.totalEdits,
          totalChecked: data.totalChecked,
          totalSkipped: data.totalSkipped,
          totalErrors: data.totalErrors,
          queue: data.queue || [],
          options: data.options || prev.options,
          detailedStats: data.detailedStats || prev.detailedStats,
          logs: data.logs || [],
        }));
      }
    } catch {
      // Ignore transient network errors
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1200);
    return () => clearInterval(interval);
  }, [botId]);

  // Auto-scroll terminal logs inside its container without scrolling the main browser window
  useEffect(() => {
    if (activeTab === "terminal" && autoScroll && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [runnerState.logs.length, autoScroll, activeTab]);

  // 2. Load History Data
  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: "25",
        search: historySearch,
        status: historyStatusFilter,
      });
      const res = await fetch(`/api/bot/history?${params.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setHistoryEntries(data.entries || []);
        setHistoryTotal(data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory();
    }
  }, [activeTab, historyPage, historyStatusFilter]);

  // 3. Control Actions (Start / Stop / Replenish / Clear)
  const handleStartBot = async () => {
    if (!user || !sessionToken) {
      openAuthModal();
      return;
    }

    setIsControlling(true);
    setActionNotice(null);
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          action: "start",
          botId,
          options: editedOptions,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setActionNotice(`Failed to start: ${data.message}`);
      } else {
        setActionNotice("Bot started in continuous background mode.");
        fetchStatus();
      }
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    } finally {
      setIsControlling(false);
    }
  };

  const handleStopBot = async () => {
    setIsControlling(true);
    // Optimistically update UI to STOPPED immediately
    setRunnerState((prev) => ({
      ...prev,
      status: "STOPPED",
      pauseUntil: null,
      cooldownRemainingSeconds: 0,
    }));

    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", botId }),
      });
      const data = await res.json();
      setActionNotice(data.message || "Bot halted immediately.");
      fetchStatus();
    } catch (err: any) {
      setActionNotice(`Error stopping bot: ${err.message}`);
    } finally {
      setIsControlling(false);
    }
  };

  const handleReplenishQueue = async () => {
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replenish",
          botId,
          count: 50,
          category: editedOptions.categoryInput,
        }),
      });
      const data = await res.json();
      setActionNotice(data.message);
      fetchStatus();
    } catch (err: any) {
      setActionNotice(`Replenish error: ${err.message}`);
    }
  };

  const handleAddCustomArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customArticleInput.trim()) return;

    setIsAddingArticle(true);
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-article",
          botId,
          title: customArticleInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCustomArticleInput("");
        setActionNotice(data.message);
        fetchStatus();
      }
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    } finally {
      setIsAddingArticle(false);
    }
  };

  const handleClearQueue = async () => {
    if (!confirm("Are you sure you want to clear the pending article queue?")) return;
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-queue", botId }),
      });
      const data = await res.json();
      setActionNotice(data.message);
      fetchStatus();
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    }
  };

  const handleSaveOptions = async () => {
    try {
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-options",
          botId,
          options: editedOptions,
        }),
      });
      const data = await res.json();
      setActionNotice(data.message || "Configuration updated successfully.");
      fetchStatus();
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Are you sure you want to clear all recorded article history?")) return;
    try {
      const res = await fetch("/api/bot/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const data = await res.json();
      if (data.success) {
        fetchHistory();
        setActionNotice("Article history registry cleared.");
      }
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    }
  };

  // Status badges
  const isRunning = runnerState.status === "RUNNING";
  const isPaused = runnerState.status === "PAUSED";
  const isStopped = runnerState.status === "STOPPED";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Breadcrumb & Operator Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Bots</span>
            </Link>
            <span className="text-slate-600">/</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  <span>{botDef.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                    {botDef.version}
                  </span>
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Status Indicator */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
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
                  ? "RUNNING (SERVER 24/7)"
                  : isPaused
                  ? `PAUSED (${runnerState.cooldownRemainingSeconds}s REST BREAK)`
                  : "STOPPED"}
              </span>
            </div>

            {/* Operator Auth Status */}
            {user ? (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs">
                <span className="text-slate-400">Operator:</span>
                <span className="font-mono text-emerald-400 font-semibold">@{user.username}</span>
                {user.role_badge && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {user.role_badge}
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={openAuthModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold border border-amber-500/30 transition"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Log In (Required)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* Notice alert */}
        {actionNotice && (
          <div className="p-3.5 rounded-xl bg-slate-800 border border-indigo-500/30 text-xs text-indigo-300 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span>{actionNotice}</span>
            </div>
            <button
              onClick={() => setActionNotice(null)}
              className="text-slate-400 hover:text-white text-xs ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Master Control Banner & 100-Burst Progress */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Column */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">Bot Operations Control</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Continuous server-side autonomous execution
                  </p>
                </div>
                <div className="p-2 rounded-xl bg-indigo-600/10 text-indigo-400 border border-indigo-500/20">
                  <Flame className="w-5 h-5" />
                </div>
              </div>

              {/* Master Start / Stop Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={handleStartBot}
                  disabled={isRunning || isControlling}
                  className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-xs tracking-wide transition shadow-lg ${
                    isRunning
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30 hover:shadow-emerald-900/50"
                  }`}
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>START BOT</span>
                </button>

                <button
                  onClick={handleStopBot}
                  disabled={isStopped || isControlling}
                  className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-xs tracking-wide transition shadow-lg ${
                    isStopped
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800"
                      : "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30 hover:shadow-rose-900/50"
                  }`}
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>STOP BOT</span>
                </button>
              </div>

              {/* Sandbox Toggle */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-white block">Safe Sandbox Mode</span>
                  <span className="text-[11px] text-slate-400 block">
                    Write test drafts to User:{user?.username || "Operator"}/sandbox
                  </span>
                </div>
                <button
                  onClick={() => {
                    const newSandbox = !editedOptions.useSandbox;
                    setEditedOptions((prev) => ({ ...prev, useSandbox: newSandbox }));
                    fetch("/api/bot/control", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "update-options",
                        botId,
                        options: { useSandbox: newSandbox },
                      }),
                    }).then(() => fetchStatus());
                  }}
                  className={`w-11 h-6 rounded-full transition relative p-0.5 ${
                    editedOptions.useSandbox ? "bg-indigo-600" : "bg-slate-700"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      editedOptions.useSandbox ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
              <span>Runs 24/7 on server even if you close this tab or leave.</span>
            </div>
          </div>

          {/* Burst Cycle Tracker (100 Edits / 1 Min Pause) */}
          <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      Cycle #{runnerState.cycleNumber} Progress
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                      Target: 100 edits/cycle
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white mt-1">
                    {runnerState.currentCycleEdits} <span className="text-slate-500 text-base font-normal">/ 100 edits completed</span>
                  </h3>
                </div>

                {isPaused && (
                  <div className="px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center gap-2 animate-pulse">
                    <Clock className="w-4 h-4" />
                    <span>60s Rest Break ({runnerState.cooldownRemainingSeconds}s remaining)</span>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    isPaused
                      ? "bg-amber-400"
                      : "bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400"
                  }`}
                  style={{ width: `${Math.min(100, runnerState.currentCycleEdits)}%` }}
                />
              </div>

              {/* Cooldown Active Message Banner */}
              {isPaused ? (
                <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-3">
                  <Clock className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-bold text-white">100 Successful Edits Completed!</p>
                    <p className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                      InternetArchiveBot is resting for exactly 1 minute to respect Justapedia API rate limits. It will automatically resume next cycle in{" "}
                      <span className="font-mono font-bold text-amber-400">{runnerState.cooldownRemainingSeconds} seconds</span>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Total Edits</span>
                    <span className="font-bold text-white text-sm font-mono">{runnerState.totalEdits}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Checked Once</span>
                    <span className="font-bold text-indigo-300 text-sm font-mono">{runnerState.totalChecked}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Skipped Duplicate</span>
                    <span className="font-bold text-slate-300 text-sm font-mono">{runnerState.totalSkipped}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Active Queue</span>
                    <span className="font-bold text-emerald-400 text-sm font-mono">{runnerState.queue.length}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Automatic burst pacing: 100 edits &rarr; 60s pause &rarr; auto-resume</span>
              <button
                onClick={handleReplenishQueue}
                className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Replenish 50 Articles</span>
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab("terminal")}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === "terminal"
                ? "border-indigo-500 text-white bg-slate-900/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Live Activity Terminal</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
              {runnerState.logs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === "history"
                ? "border-indigo-500 text-white bg-slate-900/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Article Processing History</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
              {historyTotal || runnerState.totalChecked}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("queue")}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === "queue"
                ? "border-indigo-500 text-white bg-slate-900/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>Queue Management</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/20 text-indigo-300 font-mono">
              {runnerState.queue.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === "settings"
                ? "border-indigo-500 text-white bg-slate-900/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Configuration & Rules</span>
          </button>
        </div>

        {/* Tab 1: Live Terminal */}
        {activeTab === "terminal" && (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden flex flex-col h-[520px]">
            {/* Terminal Header */}
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/60 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-500/60 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/60 inline-block" />
                <span className="text-slate-400 ml-2 font-mono">internetarchivebot@justapedia-server: ~</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Auto-scroll</span>
                </label>
              </div>
            </div>

            {/* Terminal Log Output - Scrolled internally without touching window scroll */}
            <div
              ref={terminalContainerRef}
              className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-2 bg-slate-950 scroll-smooth"
            >
              {runnerState.logs.length === 0 ? (
                <div className="text-slate-600 italic p-4 text-center">
                  No log activity recorded yet. Start the bot to begin processing.
                </div>
              ) : (
                runnerState.logs.map((log) => {
                  let badgeColor = "text-slate-400 border-slate-800 bg-slate-900";
                  if (log.level === "success") badgeColor = "text-emerald-400 border-emerald-500/20 bg-emerald-950/30";
                  if (log.level === "error") badgeColor = "text-rose-400 border-rose-500/20 bg-rose-950/30";
                  if (log.level === "warn") badgeColor = "text-amber-400 border-amber-500/20 bg-amber-950/30";
                  if (log.level === "cycle") badgeColor = "text-indigo-300 border-indigo-500/30 bg-indigo-950/40";

                  return (
                    <div
                      key={log.id}
                      className="p-2.5 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800/60 flex items-start justify-between gap-3 transition"
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 text-[11px]">{log.timestamp}</span>
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase border ${badgeColor}`}>
                            {log.level}
                          </span>
                          {log.articleTitle && (
                            <a
                              href={`https://justapedia.org/${encodeURIComponent(log.articleTitle.replace(/ /g, "_"))}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:underline font-semibold"
                            >
                              [{log.articleTitle}]
                            </a>
                          )}
                        </div>
                        <p className="text-slate-300 text-xs leading-relaxed">{log.message}</p>
                      </div>

                      {log.diffUrl && (
                        <a
                          href={log.diffUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-[11px] font-medium flex items-center gap-1 transition flex-shrink-0"
                        >
                          <span>Diff</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Processing History */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-[240px]">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchHistory()}
                    placeholder="Search processed articles..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <select
                  value={historyStatusFilter}
                  onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">All Outcomes</option>
                  <option value="edited_and_resolved">Fixed & Saved</option>
                  <option value="verified_healthy">Verified Clean (0 issues)</option>
                  <option value="skipped_unchanged">Skipped Unchanged</option>
                </select>
                <button
                  onClick={fetchHistory}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                >
                  Filter
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchHistory}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Refresh History"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleClearHistory}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear History</span>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Article Title</th>
                      <th className="py-3 px-4">Checked Revision</th>
                      <th className="py-3 px-4">Outcome</th>
                      <th className="py-3 px-4">Issues Fixed</th>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {historyEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 italic">
                          {isLoadingHistory ? "Loading history records..." : "No article history records found."}
                        </td>
                      </tr>
                    ) : (
                      historyEntries.map((entry, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 font-sans font-medium text-white">
                            <a
                              href={`https://justapedia.org/${encodeURIComponent(entry.title.replace(/ /g, "_"))}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:underline"
                            >
                              {entry.title}
                            </a>
                          </td>
                          <td className="py-3 px-4 text-slate-400">
                            #{entry.lastCheckedRevid || entry.revidSaved || "live"}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            {entry.status === "edited_and_resolved" ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                Fixed & Saved
                              </span>
                            ) : entry.status === "verified_healthy" ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                Verified Clean
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-300">
                                {entry.status}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-300">
                            {entry.issuesFixed > 0 ? (
                              <span className="text-emerald-400 font-bold">{entry.issuesFixed} link(s)</span>
                            ) : (
                              <span className="text-slate-500">0</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-400 text-[11px]">
                            {entry.lastCheckedTimestamp}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {entry.diffUrl ? (
                              <a
                                href={entry.diffUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[11px] font-medium inline-flex items-center gap-1 border border-indigo-500/30"
                              >
                                <span>Diff</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <a
                                href={`https://justapedia.org/${encodeURIComponent(entry.title.replace(/ /g, "_"))}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-400 hover:text-white text-[11px]"
                              >
                                View Page
                              </a>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {historyTotal > 25 && (
                <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Showing {historyEntries.length} of {historyTotal} recorded articles
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage === 1}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
                    >
                      Previous
                    </button>
                    <span className="font-mono text-white">Page {historyPage}</span>
                    <button
                      onClick={() => setHistoryPage((p) => p + 1)}
                      disabled={historyEntries.length < 25}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Queue Management */}
        {activeTab === "queue" && (
          <div className="space-y-6">
            {/* Top Queue Controls */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">Add Article to Top of Queue</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Queue a specific article for immediate priority inspection
                  </p>
                </div>
                <button
                  onClick={handleReplenishQueue}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Crawl 50 Articles from Category</span>
                </button>
              </div>

              <form onSubmit={handleAddCustomArticle} className="flex gap-2">
                <input
                  type="text"
                  value={customArticleInput}
                  onChange={(e) => setCustomArticleInput(e.target.value)}
                  placeholder="Enter Justapedia page title (e.g. Grace Hopper)..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isAddingArticle || !customArticleInput.trim()}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Article</span>
                </button>
              </form>
            </div>

            {/* Current Queue List */}
            <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
                <div className="flex items-center gap-2">
                  <ListOrdered className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Pending Articles ({runnerState.queue.length})
                  </h4>
                </div>
                {runnerState.queue.length > 0 && (
                  <button
                    onClick={handleClearQueue}
                    className="text-xs text-rose-400 hover:text-rose-300 font-medium flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>

              <div className="p-4 max-h-[420px] overflow-y-auto divide-y divide-slate-800/40">
                {runnerState.queue.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 italic text-xs">
                    Queue is empty. Click &quot;Crawl 50 Articles from Category&quot; or add an article above.
                  </div>
                ) : (
                  runnerState.queue.map((title, idx) => (
                    <div
                      key={idx}
                      className="py-2.5 px-3 flex items-center justify-between text-xs hover:bg-slate-800/40 rounded-lg transition"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-500 text-[11px] w-6">#{idx + 1}</span>
                        <a
                          href={`https://justapedia.org/${encodeURIComponent(title.replace(/ /g, "_"))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-white hover:text-indigo-300"
                        >
                          {title}
                        </a>
                      </div>
                      <a
                        href={`https://justapedia.org/${encodeURIComponent(title.replace(/ /g, "_"))}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-500 hover:text-white"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Configuration & Settings */}
        {activeTab === "settings" && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-6">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">InternetArchiveBot Configuration</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Customize reference inspection, repair thresholds, and crawling sources
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Option 1: Category source */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Crawl Category Source
                </label>
                <input
                  type="text"
                  value={editedOptions.categoryInput}
                  onChange={(e) =>
                    setEditedOptions((prev) => ({ ...prev, categoryInput: e.target.value }))
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-slate-500 block">
                  MediaWiki category crawled to replenish the editing queue.
                </span>
              </div>

              {/* Option 2: Max links per page */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Max Links Checked Per Article ({editedOptions.maxLinksPerPage})
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={editedOptions.maxLinksPerPage}
                  onChange={(e) =>
                    setEditedOptions((prev) => ({
                      ...prev,
                      maxLinksPerPage: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full accent-indigo-500"
                />
                <span className="text-[11px] text-slate-500 block">
                  Bounds link verification latency on large articles with hundreds of citations.
                </span>
              </div>

              {/* Option 3: Repair broken archives */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-white block">Repair Broken Archives</span>
                  <span className="text-[11px] text-slate-400 block leading-relaxed">
                    Scan existing Wayback Machine links; if dead or invalid, search CDX API for nearest snapshot replacement.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={editedOptions.repairBrokenArchives}
                  onChange={(e) =>
                    setEditedOptions((prev) => ({
                      ...prev,
                      repairBrokenArchives: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0 mt-1"
                />
              </div>

              {/* Option 4: Tag unrecoverable dead links */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-white block">Tag Unrecoverable Dead Links</span>
                  <span className="text-[11px] text-slate-400 block leading-relaxed">
                    Append Justapedia template &#123;&#123;dead link&#125;&#125; when no Wayback archive snapshot exists.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={editedOptions.tagUnrecoverableDead}
                  onChange={(e) =>
                    setEditedOptions((prev) => ({
                      ...prev,
                      tagUnrecoverableDead: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0 mt-1"
                />
              </div>

              {/* Option 5: Archive working links */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-white block">Archive Working References</span>
                  <span className="text-[11px] text-slate-400 block leading-relaxed">
                    Proactively trigger Wayback Machine &quot;Save Page Now&quot; for working references that lack snapshots.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={editedOptions.archiveWorkingLinks}
                  onChange={(e) =>
                    setEditedOptions((prev) => ({
                      ...prev,
                      archiveWorkingLinks: e.target.checked,
                    }))
                  }
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0 mt-1"
                />
              </div>

              {/* Option 6: Burst Limit Info */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1">
                <span className="text-xs font-semibold text-white block">Burst Pacing & Rest Cycle</span>
                <span className="text-[11px] text-slate-400 block leading-relaxed">
                  Fixed at <strong className="text-indigo-300">100 edits/cycle</strong> followed by an automated{" "}
                  <strong className="text-amber-300">60-second break</strong> to comply with Justapedia bot policies.
                </span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-end">
              <button
                onClick={handleSaveOptions}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save Configuration</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
