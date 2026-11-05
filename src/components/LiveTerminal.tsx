"use client";

import React, { useState, useEffect, useRef } from "react";
import { BotDefinition, BotState, BotTerminalLog, BotLogLevel } from "@/lib/types";
import { 
  Terminal, 
  X, 
  Play, 
  Square, 
  Pause, 
  RotateCcw, 
  ExternalLink, 
  Filter, 
  Download, 
  Zap, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck,
  Flame,
  Layers
} from "lucide-react";

interface LiveTerminalProps {
  bot: BotDefinition;
  botState: BotState;
  isOpen: boolean;
  onClose: () => void;
  onToggleStatus: () => void;
  onClearLogs: () => void;
  loggedInUsername?: string | null;
}

export function LiveTerminal({
  bot,
  botState,
  isOpen,
  onClose,
  onToggleStatus,
  onClearLogs,
  loggedInUsername,
}: LiveTerminalProps) {
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [botState.logs, autoScroll]);

  if (!isOpen) return null;

  const filteredLogs = botState.logs.filter((log) => {
    if (filterLevel === "all") return true;
    if (filterLevel === "edits") return log.articleTitle || log.diffUrl;
    if (filterLevel === "rescues") {
      return (
        log.message.includes("Rescued") ||
        log.message.includes("Repaired") ||
        log.message.includes("SAVE SUCCESS") ||
        log.level === "success"
      );
    }
    return log.level === filterLevel;
  });

  const getLevelBadge = (level: BotLogLevel) => {
    switch (level) {
      case "success":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">SUCCESS</span>;
      case "error":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">ERROR</span>;
      case "warn":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>;
      case "cycle":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">CYCLE</span>;
      case "auth":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">USER AUTH</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-700/50 text-slate-400 border border-slate-700">INFO</span>;
    }
  };

  const exportLogsAsText = () => {
    const content = botState.logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message} ${l.diffUrl ? `(Diff: ${l.diffUrl})` : ""}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bot.id}-live-terminal-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-5xl h-[88vh] max-h-[850px] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Terminal Title Bar */}
        <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 font-sans">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-rose-500/80 cursor-pointer" onClick={onClose} />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>

            <div className="h-4 w-px bg-slate-800 hidden sm:block" />

            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-white text-sm">
                Bot #{bot.number}: {bot.name}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {bot.version}
              </span>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-3 text-xs">
            {/* Status Pill */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              botState.status === "ON" 
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : botState.status === "PAUSED"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                botState.status === "ON" ? "bg-emerald-400 animate-pulse" : botState.status === "PAUSED" ? "bg-amber-400 animate-ping" : "bg-slate-500"
              }`} />
              <span>STATUS: {botState.status}</span>
            </div>

            {/* Cycle edits count */}
            <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800/80 text-slate-300 border border-slate-700">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>Cycle: <strong className="text-white font-mono">{botState.currentCycleEdits}/100</strong> edits</span>
            </div>

            {/* Cooldown timer */}
            {botState.isCooldown && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                <Clock className="w-3.5 h-3.5" />
                <span>Cooldown: {botState.cooldownRemainingSeconds}s</span>
              </div>
            )}

            {/* Control button */}
            <button
              onClick={onToggleStatus}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition ${
                botState.status === "ON" || botState.status === "PAUSED"
                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
              }`}
            >
              {botState.status === "ON" || botState.status === "PAUSED" ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Start</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close Terminal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Attribution Notice */}
        <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-sans">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Attribution Mode:{" "}
              {loggedInUsername ? (
                <span className="text-emerald-300 font-mono font-medium">
                  Logged-in User Account (@{loggedInUsername})
                </span>
              ) : (
                <span className="text-amber-400 font-medium">
                  Guest Mode (Read/Analyze only — Sign in to save directly to your Justapedia contribution history)
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-indigo-400 font-mono">100 edits/min pacing</span>
            <span>•</span>
            <span className="text-slate-500">60s cycle cooldown</span>
          </div>
        </div>

        {/* IABot Operational Metrics Strip (InternetBot only) */}
        {bot.id === "internet-bot" && botState.detailedStats && (
          <div className="px-4 py-2 bg-slate-950 border-b border-slate-900 grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Checked:</span>
              <span className="text-white font-bold">{botState.detailedStats.referencesChecked}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-rose-400">Dead:</span>
              <span className="text-rose-300 font-bold">{botState.detailedStats.deadLinksDetected}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">Rescued:</span>
              <span className="text-emerald-300 font-bold">{botState.detailedStats.archiveLinksAdded}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-cyan-400">Repaired:</span>
              <span className="text-cyan-300 font-bold">{botState.detailedStats.archiveLinksRepaired}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-indigo-400">Snapshots:</span>
              <span className="text-indigo-300 font-bold">{botState.detailedStats.newSnapshotsRequested}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-amber-400">Tagged:</span>
              <span className="text-amber-300 font-bold">{botState.detailedStats.unrecoverableLinksTagged}</span>
            </div>
          </div>
        )}

        {/* Toolbar & Filter */}
        <div className="px-4 py-2 bg-slate-950 border-b border-slate-900 flex items-center justify-between gap-2 text-xs font-sans">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-slate-500 text-[11px] flex items-center gap-1 mr-1">
              <Filter className="w-3 h-3" /> Filter:
            </span>
            {(["all", "edits", "rescues", "success", "error", "auth", "cycle"] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-0.5 rounded text-[11px] capitalize transition ${
                  filterLevel === lvl
                    ? "bg-indigo-600 text-white font-medium shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 w-3 h-3"
              />
              <span>Auto-scroll</span>
            </label>

            <button
              onClick={exportLogsAsText}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-900 transition"
              title="Download Logs as TXT"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onClearLogs}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-900 transition"
              title="Clear Terminal Logs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal Screen */}
        <div 
          ref={logContainerRef}
          className="flex-1 p-4 overflow-y-auto space-y-1.5 text-xs text-slate-300 font-mono bg-black/90 selection:bg-indigo-900 selection:text-white"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
              <Terminal className="w-8 h-8 opacity-40" />
              <p>No terminal output yet for this filter.</p>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div 
                key={log.id} 
                className="flex items-start gap-2.5 py-1 px-1.5 rounded hover:bg-slate-900/60 transition group font-mono"
              >
                {/* Timestamp */}
                <span className="text-slate-500 text-[11px] select-none flex-shrink-0">
                  [{log.timestamp}]
                </span>

                {/* Level Tag */}
                <div className="flex-shrink-0">
                  {getLevelBadge(log.level)}
                </div>

                {/* Message Body */}
                <div className="flex-1 break-all leading-relaxed text-slate-200">
                  {log.articleTitle && (
                    <a
                      href={`https://justapedia.org/${encodeURIComponent(log.articleTitle.replace(/ /g, "_"))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-indigo-300 hover:underline mr-2 bg-indigo-950/60 px-1.5 py-0.2 rounded border border-indigo-800/50"
                    >
                      <span>{log.articleTitle}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}

                  <span>{log.message}</span>

                  {log.diffUrl && (
                    <a
                      href={log.diffUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 ml-2 text-emerald-400 hover:underline bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-800/40"
                    >
                      <span>View Diff (rev #{log.revid})</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Running Cursor / Cooldown notice */}
          {botState.status === "ON" && (
            <div className="flex items-center gap-2 pt-2 text-emerald-400 animate-pulse text-[11px]">
              <span className="inline-block w-2 h-3 bg-emerald-400" />
              <span>Processing Justapedia article queue @ ~600ms per edit (burst pacing)...</span>
            </div>
          )}

          {botState.status === "PAUSED" && (
            <div className="flex items-center gap-2 pt-2 text-amber-400 text-[11px]">
              <span className="inline-block w-2 h-3 bg-amber-400 animate-ping" />
              <span>
                [CYCLE COOLDOWN] 100 edits completed. Pausing for {botState.cooldownRemainingSeconds} seconds before auto-resuming...
              </span>
            </div>
          )}
        </div>

        {/* Terminal Status Footer */}
        <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-sans">
          <div className="flex items-center gap-4">
            <span>Total Lifetime Edits: <strong className="text-white font-mono">{botState.totalEdits}</strong></span>
            <span>Success: <strong className="text-emerald-400 font-mono">{botState.successCount}</strong></span>
            <span>Errors: <strong className="text-rose-400 font-mono">{botState.errorCount}</strong></span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Connected: https://justapedia.org/api.php</span>
          </div>
        </div>

      </div>
    </div>
  );
}
