"use client";

import { useState, useEffect } from "react";
import { Settings2, Save, Check, RotateCcw, ShieldCheck, Database, Globe } from "lucide-react";

interface BotConfig {
  deadLinkTemplate: string;
  webArchiveTemplate: string;
  noBotsTemplate: string;
  editSummary: string;
  apiUrl: string;
  preferClosestDate: boolean;
  scanMainspaceOnly: boolean;
}

const DEFAULT_CONFIG: BotConfig = {
  deadLinkTemplate: "{{dead link|date={date}}}",
  webArchiveTemplate: "{{Webarchive|url={url}|date={date}}}",
  noBotsTemplate: "{{nobots}}",
  editSummary: "Archiving dead external links using Wayback Machine via ArchiveBot",
  apiUrl: "https://justapedia.org/api.php",
  preferClosestDate: true,
  scanMainspaceOnly: false,
};

export default function SettingsPage() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const local = localStorage.getItem("justapedia_bot_config");
      if (local) {
        setConfig(JSON.parse(local));
      }
    } catch {
      // fallback
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem("justapedia_bot_config", JSON.stringify(config));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    try {
      localStorage.removeItem("justapedia_bot_config");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-8">
      <div>
        <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
          <Settings2 className="w-4 h-4" />
          <span>Application Configuration</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Bot & Template Settings</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">
          Configure default template syntax, edit summaries, and API endpoints for Justapedia. Settings are persisted in your browser without requiring a database.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* API Endpoint Section */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-400" />
            <span>Target Justapedia MediaWiki API</span>
          </h3>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">API Endpoint URL</label>
            <input
              type="url"
              required
              value={config.apiUrl}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Standard Justapedia API location: <code className="text-slate-400">https://justapedia.org/api.php</code>
            </p>
          </div>
        </div>

        {/* Templates Section */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Template Syntax on Justapedia</span>
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Dead Link Template Format</label>
              <input
                type="text"
                value={config.deadLinkTemplate}
                onChange={(e) => setConfig({ ...config, deadLinkTemplate: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Webarchive Template Format</label>
              <input
                type="text"
                value={config.webArchiveTemplate}
                onChange={(e) => setConfig({ ...config, webArchiveTemplate: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Bot Exemption Tag</label>
              <input
                type="text"
                value={config.noBotsTemplate}
                onChange={(e) => setConfig({ ...config, noBotsTemplate: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Edit Summary Section */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <h3 className="text-sm font-semibold text-white">Proposed Edit Summary</h3>

          <div>
            <textarea
              rows={2}
              value={config.editSummary}
              onChange={(e) => setConfig({ ...config, editSummary: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="space-y-3 pt-2 text-xs text-slate-300 border-t border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.preferClosestDate}
                onChange={(e) => setConfig({ ...config, preferClosestDate: e.target.checked })}
                className="rounded border-slate-700 text-indigo-600 bg-slate-950"
              />
              <span>Prefer Wayback snapshots closest to the article citation date (rather than newest)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.scanMainspaceOnly}
                onChange={(e) => setConfig({ ...config, scanMainspaceOnly: e.target.checked })}
                className="rounded border-slate-700 text-indigo-600 bg-slate-950"
              />
              <span>Restrict scans to main article namespace (namespace 0)</span>
            </label>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>

          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition"
          >
            {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
            <span>{saved ? "Settings Saved!" : "Save Preferences"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
