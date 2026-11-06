"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Search, 
  ExternalLink, 
  CheckCircle2, 
  AlertTriangle, 
  Database, 
  Globe2, 
  Sparkles,
  Clock,
  ArrowRight,
  RefreshCw
} from "lucide-react";
import { UrlCheckResult } from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AuthGate } from "@/components/AuthGate";

export default function InspectorPage() {
  const { user, sessionToken, isLoading } = useAuth();
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingArchive, setSavingArchive] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UrlCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setArchiveMessage(null);

    try {
      const res = await fetch("/api/check-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to inspect URL");

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Failed to connect to inspector service");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToWayback = async () => {
    if (!result?.url) return;
    setSavingArchive(true);
    setArchiveMessage(null);

    try {
      const res = await fetch("/api/save-archive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ url: result.url }),
      });
      const data = await res.json();
      setArchiveMessage(data.message || "Save request completed.");
    } catch (err: any) {
      setArchiveMessage(`Failed to trigger archive: ${err.message}`);
    } finally {
      setSavingArchive(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 w-full bg-slate-950 flex items-center justify-center py-24 text-slate-400">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
          <span>Verifying security permissions...</span>
        </div>
      </div>
    );
  }

  if (!user || (!user.is_bot && !user.is_admin)) {
    return (
      <AuthGate
        title="URL Inspector Diagnostics Restricted"
        description="The URL Inspector performs live external server probes and interfaces with Wayback snapshot services. Access is restricted exclusively to authenticated Justapedia users holding Bot or Administrator privileges."
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
          <Globe2 className="w-4 h-4" />
          <span>Real-time Link Diagnostics</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">URL Inspector & Rot Tester</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">
          Inspect individual external URLs to check live HTTP server status, network response latency, and Internet Archive Wayback Machine snapshot availability.
        </p>
      </div>

      {/* Input */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <form onSubmit={handleInspect} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="url"
              required
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/article.html"
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-md transition disabled:opacity-50 shrink-0"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Testing URL...</span>
              </>
            ) : (
              <>
                <span>Inspect URL</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 pt-1">
          <span className="text-slate-500">Quick tests:</span>
          {["https://justapedia.org", "https://example.com", "https://archive.org"].map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrlInput(u)}
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 hover:text-white transition font-mono text-[11px]"
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Error Output */}
      {error && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Result Card */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-2xl">
            {/* Title Bar */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-white text-sm">Diagnostic Report</span>
                {result.status === "alive" ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ALIVE & RESPONSIVE
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> DEAD / UNREACHABLE
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-mono">Domain: {result.domain}</span>
            </div>

            {/* Metrics Grid */}
            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-slate-800">
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 text-xs">HTTP Status Code</span>
                <p className="text-xl font-mono font-bold text-white mt-1">
                  {result.httpCode ? `HTTP ${result.httpCode}` : "Connection Failed"}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 text-xs">Response Latency</span>
                <p className="text-xl font-mono font-bold text-white mt-1">
                  {result.latencyMs} ms
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-slate-400 text-xs">Checked At</span>
                <p className="text-xs font-mono text-slate-300 mt-2 truncate">
                  {new Date(result.checkedAt).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Wayback Details */}
            <div className="p-6 bg-slate-950/30 space-y-4">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                <span>Internet Archive Wayback Machine Record</span>
              </h4>

              {result.waybackSnapshot ? (
                <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-indigo-300 font-medium">Snapshot Available</span>
                    <span className="text-[11px] font-mono text-indigo-400">
                      Captured: {formatTimestamp(result.waybackSnapshot.timestamp)}
                    </span>
                  </div>

                  <a
                    href={result.waybackSnapshot.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-white hover:text-indigo-300 font-mono flex items-center gap-1.5 underline break-all"
                  >
                    {result.waybackSnapshot.url}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-400">No previous snapshot found in the Wayback Machine.</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">You can trigger an on-demand snapshot to archive this page now.</p>
                  </div>

                  <button
                    onClick={handleSaveToWayback}
                    disabled={savingArchive}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{savingArchive ? "Archiving..." : "Save to Wayback Machine"}</span>
                  </button>
                </div>
              )}

              {archiveMessage && (
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs">
                  {archiveMessage}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
