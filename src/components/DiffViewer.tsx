"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { 
  Check, 
  Copy, 
  ExternalLink, 
  Columns, 
  AlignLeft, 
  Save, 
  History, 
  CheckCircle2, 
  AlertCircle,
  Lock,
  Sparkles
} from "lucide-react";

interface DiffViewerProps {
  pageTitle: string;
  originalWikitext: string;
  fixedWikitext: string;
  hasModifications: boolean;
}

export function DiffViewer({
  pageTitle,
  originalWikitext,
  fixedWikitext,
  hasModifications,
}: DiffViewerProps) {
  const { user, sessionToken, openAuthModal } = useAuth();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"side-by-side" | "unified">("side-by-side");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<any>(null);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fixedWikitext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDirectSave = async () => {
    if (!user || !sessionToken) {
      openAuthModal();
      return;
    }

    setIsSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch("/api/bot/save-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          title: pageTitle,
          wikitext: fixedWikitext,
          summary: `Repaired dead citations & link rot via Justapedia ArchiveBot (attributable to ${user.username})`,
          use_sandbox: false,
        }),
      });

      const data = await res.json();
      setSaveResult(data);
    } catch (err: any) {
      setSaveResult({ success: false, message: err.message || "Failed to save edit." });
    } finally {
      setIsSaving(false);
    }
  };

  const editUrl = `https://justapedia.org/index.php?title=${encodeURIComponent(pageTitle)}&action=edit`;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-2xl">
      {/* Diff Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white text-sm">Wikitext Modifications</span>
          {hasModifications ? (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Modifications Proposed
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
              No Changes Needed
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View mode toggle */}
          <div className="hidden sm:flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60">
            <button
              onClick={() => setViewMode("side-by-side")}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                viewMode === "side-by-side"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              Side by Side
            </button>
            <button
              onClick={() => setViewMode("unified")}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition ${
                viewMode === "unified"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5" />
              Unified
            </button>
          </div>

          {/* Copy Button */}
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            {copied ? "Copied!" : "Copy Wikitext"}
          </button>

          {/* Direct Save Button (User Authenticated) */}
          {hasModifications && (
            <button
              onClick={handleDirectSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 disabled:opacity-50 transition"
              title={user ? `Save directly as @${user.username}` : "Log in to save directly"}
            >
              {isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : user ? (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save as @{user.username}</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Sign in to Save</span>
                </>
              )}
            </button>
          )}

          {/* Manual Edit on Justapedia button */}
          <a
            href={editUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition"
          >
            <span>Edit on Wiki</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Save Notification Banner */}
      {saveResult && (
        <div className={`p-4 border-b border-slate-800 flex items-start justify-between gap-3 ${
          saveResult.success ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
        }`}>
          <div className="flex items-start gap-2.5">
            {saveResult.success ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
            )}
            <div>
              <p className="text-xs font-semibold">{saveResult.message}</p>
              {saveResult.diff_url && (
                <div className="flex items-center gap-3 mt-1.5 text-xs">
                  <a
                    href={saveResult.diff_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>View Revision Diff (rev #{saveResult.revid})</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span>•</span>
                  <a
                    href={saveResult.user_contributions_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Check User Contributions</span>
                    <History className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setSaveResult(null)}
            className="text-slate-400 hover:text-white text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Diff Content View */}
      {viewMode === "side-by-side" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-800">
          {/* Original */}
          <div className="p-4 flex flex-col h-[500px]">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400 font-mono">
              <span>Original Wikitext</span>
              <span>{originalWikitext.length} chars</span>
            </div>
            <textarea
              readOnly
              value={originalWikitext}
              className="w-full flex-1 bg-slate-950/40 text-slate-300 font-mono text-xs p-3 rounded-lg border border-slate-800/80 resize-none focus:outline-none focus:ring-1 focus:ring-slate-700"
            />
          </div>

          {/* Proposed Fixed */}
          <div className="p-4 flex flex-col h-[500px] bg-slate-950/20">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-emerald-400 font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Proposed Fixed Wikitext
              </span>
              <span>{fixedWikitext.length} chars</span>
            </div>
            <textarea
              readOnly
              value={fixedWikitext}
              className="w-full flex-1 bg-slate-950/60 text-emerald-300 font-mono text-xs p-3 rounded-lg border border-emerald-950/40 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-700/50"
            />
          </div>
        </div>
      ) : (
        <div className="p-4 h-[500px] flex flex-col">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400 font-mono">
            <span>Unified Fixed Wikitext Output</span>
            <span>{fixedWikitext.length} chars</span>
          </div>
          <textarea
            readOnly
            value={fixedWikitext}
            className="w-full flex-1 bg-slate-950/50 text-slate-200 font-mono text-xs p-3 rounded-lg border border-slate-800 resize-none focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
