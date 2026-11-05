"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { 
  Search, 
  ArrowRight, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw, 
  FileText, 
  Sparkles,
  Sliders,
  ChevronDown,
  Info
} from "lucide-react";
import { PageAnalysisResult, ExtractedLink } from "@/lib/types";
import { DiffViewer } from "@/components/DiffViewer";
import { ScanProgress } from "@/components/ScanProgress";

function AnalyzerContent() {
  const searchParams = useSearchParams();
  const initialPage = searchParams.get("page") || "";

  const [pageInput, setPageInput] = useState(initialPage);
  const [archiveAll, setArchiveAll] = useState(false);
  const [checkWayback, setCheckWayback] = useState(true);
  const [showOptions, setShowOptions] = useState(false);

  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<PageAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trigger scan if initialPage is in query string
  useEffect(() => {
    if (initialPage && !analysisResult && !loading) {
      runAnalysis(initialPage);
    }
  }, [initialPage]);

  const runAnalysis = async (title: string) => {
    if (!title.trim()) return;

    setLoading(true);
    setError(null);
    setAnalysisResult(null);
    setCurrentStep(0);

    // Simulate animated step progression while serverless API handles batch analysis
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 1200);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageTitle: title.trim(),
          archiveAll,
          checkWayback,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      setAnalysisResult(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during analysis.");
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runAnalysis(pageInput);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-8">
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
          <FileText className="w-4 h-4" />
          <span>Justapedia Single Page Inspection</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Page Citation Analyzer
        </h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
          Queries <code className="text-indigo-300 font-mono">https://justapedia.org/api.php</code> directly to parse citations, verify external URL health in real time, and match broken links with Wayback Machine archives.
        </p>
      </div>

      {/* Input & Form */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-xl space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              required
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              placeholder="Enter Justapedia article title (e.g. Justapedia:Sandbox, HTTPS)..."
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
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Analyzing Page...</span>
              </>
            ) : (
              <>
                <span>Analyze Page</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Expandable Options */}
        <div className="border-t border-slate-800/80 pt-3">
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            <span>Advanced Scan Settings</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOptions ? "rotate-180" : ""}`} />
          </button>

          {showOptions && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300 pt-2"
            >
              <label className="flex items-center gap-2.5 cursor-pointer bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <input
                  type="checkbox"
                  checked={checkWayback}
                  onChange={(e) => setCheckWayback(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
                />
                <span>Automatically query Wayback Machine archives for dead links</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <input
                  type="checkbox"
                  checked={archiveAll}
                  onChange={(e) => setArchiveAll(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
                />
                <span>Check archive availability for all links (including live ones)</span>
              </label>
            </motion.div>
          )}
        </div>
      </div>

      {/* Loading Progress State */}
      {loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <ScanProgress currentStep={currentStep} />
        </motion.div>
      )}

      {/* Error Alert */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-200">Analysis Error</p>
            <p className="text-xs text-rose-300 mt-1">{error}</p>
          </div>
        </motion.div>
      )}

      {/* Results View */}
      {analysisResult && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] uppercase font-semibold text-slate-400">Total Links</span>
              <p className="text-2xl font-bold text-white mt-1">{analysisResult.stats.totalLinks}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] uppercase font-semibold text-emerald-400">Alive & Live</span>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{analysisResult.stats.aliveLinks}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] uppercase font-semibold text-rose-400">Dead / Broken</span>
              <p className="text-2xl font-bold text-rose-400 mt-1">{analysisResult.stats.deadLinks}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-[11px] uppercase font-semibold text-indigo-400">Rescued (Wayback)</span>
              <p className="text-2xl font-bold text-indigo-400 mt-1">{analysisResult.stats.rescuedLinks}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 col-span-2 sm:col-span-1">
              <span className="text-[11px] uppercase font-semibold text-amber-400">Tagged Dead</span>
              <p className="text-2xl font-bold text-amber-400 mt-1">{analysisResult.stats.taggedLinks}</p>
            </div>
          </div>

          {/* Links Breakdown Table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span>Extracted Citations & URLs</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs">
                  {analysisResult.links.length}
                </span>
              </h3>
              <span className="text-xs text-slate-500 font-mono">
                {analysisResult.durationMs}ms scan time
              </span>
            </div>

            {analysisResult.links.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No external links or references found on this page.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/40 text-slate-400 font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">URL & Domain</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Health</th>
                      <th className="px-4 py-3">Wayback Snapshot</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {analysisResult.links.map((link) => (
                      <tr key={link.id} className="hover:bg-slate-800/30 transition">
                        {/* URL */}
                        <td className="px-4 py-3 max-w-xs sm:max-w-md truncate">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:text-indigo-400 font-mono truncate block"
                            title={link.url}
                          >
                            {link.url}
                          </a>
                          <span className="text-slate-500 font-mono text-[10px]">{link.domain}</span>
                        </td>

                        {/* Type */}
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px] uppercase">
                            {link.templateName || link.linkType}
                          </span>
                        </td>

                        {/* Health */}
                        <td className="px-4 py-3">
                          {link.status === "alive" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Alive {link.httpCode ? `(${link.httpCode})` : ""}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Dead {link.httpCode ? `(${link.httpCode})` : link.error ? `(${link.error})` : ""}</span>
                            </span>
                          )}
                        </td>

                        {/* Wayback */}
                        <td className="px-4 py-3">
                          {link.waybackSnapshot ? (
                            <a
                              href={link.waybackSnapshot.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-400 hover:text-indigo-300 font-mono flex items-center gap-1 underline"
                            >
                              Available ({link.waybackSnapshot.timestamp.substring(0, 8)}){" "}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-500 italic text-[11px]">None available</span>
                          )}
                        </td>

                        {/* Proposed Action */}
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {link.proposedFix?.action === "add_archive" ? (
                            <span className="text-emerald-400">Add Wayback Archive</span>
                          ) : link.proposedFix?.action === "tag_dead" ? (
                            <span className="text-amber-400">Add dead link tag</span>
                          ) : (
                            <span className="text-slate-500">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Wikitext Diff Viewer */}
          <DiffViewer
            pageTitle={analysisResult.pageTitle}
            originalWikitext={analysisResult.originalWikitext}
            fixedWikitext={analysisResult.fixedWikitext}
            hasModifications={analysisResult.hasModifications}
          />

        </motion.div>
      )}
    </div>
  );
}

export default function AnalyzerPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-slate-400">Loading Page Analyzer...</div>}>
      <AnalyzerContent />
    </Suspense>
  );
}
