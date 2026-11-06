"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Plus, Trash2, Search, ShieldCheck, Lock, ExternalLink, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { AuthGate } from "@/components/AuthGate";

interface DomainRule {
  domain: string;
  isPaywalled: boolean;
  optOut: boolean;
  note: string;
}

const DEFAULT_RULES: DomainRule[] = [
  { domain: "nytimes.com", isPaywalled: true, optOut: false, note: "Soft paywall" },
  { domain: "wsj.com", isPaywalled: true, optOut: false, note: "Hard paywall" },
  { domain: "bloomberg.com", isPaywalled: true, optOut: false, note: "Metered paywall" },
  { domain: "ft.com", isPaywalled: true, optOut: false, note: "Hard paywall" },
  { domain: "archive.org", isPaywalled: false, optOut: true, note: "Archive service (self-reference)" },
  { domain: "web.archive.org", isPaywalled: false, optOut: true, note: "Wayback Machine snapshot root" },
];

export default function DomainsPage() {
  const { user, isLoading } = useAuth();
  const [rules, setRules] = useState<DomainRule[]>(DEFAULT_RULES);
  const [searchTerm, setSearchTerm] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newIsPaywalled, setNewIsPaywalled] = useState(false);
  const [newOptOut, setNewOptOut] = useState(false);
  const [newNote, setNewNote] = useState("");

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("justapedia_domain_rules");
      if (saved) {
        setRules(JSON.parse(saved));
      }
    } catch {
      // fallback to defaults
    }
  }, []);

  const saveRules = (updated: DomainRule[]) => {
    setRules(updated);
    try {
      localStorage.setItem("justapedia_domain_rules", JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save rules to localStorage:", e);
    }
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    const domainClean = newDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domainClean) return;

    const updated = [
      {
        domain: domainClean,
        isPaywalled: newIsPaywalled,
        optOut: newOptOut,
        note: newNote.trim() || "User-defined rule",
      },
      ...rules.filter((r) => r.domain !== domainClean),
    ];

    saveRules(updated);
    setNewDomain("");
    setNewNote("");
    setNewIsPaywalled(false);
    setNewOptOut(false);
  };

  const handleDeleteRule = (domain: string) => {
    const updated = rules.filter((r) => r.domain !== domain);
    saveRules(updated);
  };

  const filteredRules = rules.filter(
    (r) =>
      r.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.note.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
        title="Domain Rules Management Restricted"
        description="Configuring domain handling policies, paywall bypass rules, and archiving exclusion lists is restricted exclusively to authenticated Justapedia users holding Bot or Administrator privileges."
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-8">
      <div>
        <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
          <Globe className="w-4 h-4" />
          <span>Domain Governance</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Domain & Paywall Rules</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-2xl leading-relaxed">
          Manage paywall flags and archive handling rules for external citation domains. Saved locally without database dependency.
        </p>
      </div>

      {/* Add Rule Form */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-400" />
          <span>Add or Override Domain Rule</span>
        </h3>

        <form onSubmit={handleAddRule} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            required
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="domain.com (e.g. nature.com)"
            className="sm:col-span-2 bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Note / Reason..."
            className="bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition"
          >
            Save Rule
          </button>

          <div className="sm:col-span-4 flex flex-wrap gap-4 pt-1 text-xs text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newIsPaywalled}
                onChange={(e) => setNewIsPaywalled(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 bg-slate-950"
              />
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-400" /> Mark as Paywalled
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={newOptOut}
                onChange={(e) => setNewOptOut(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 bg-slate-950"
              />
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-indigo-400" /> Opt out from automated modification
              </span>
            </label>
          </div>
        </form>
      </div>

      {/* Domain List Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search domain rules..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <span className="text-xs text-slate-400 font-mono">
            {filteredRules.length} domain rules active
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/40 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-5 py-3">Domain</th>
                <th className="px-5 py-3">Paywall Status</th>
                <th className="px-5 py-3">Opt-Out</th>
                <th className="px-5 py-3">Note</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredRules.map((r) => (
                <tr key={r.domain} className="hover:bg-slate-800/20 transition">
                  <td className="px-5 py-3 font-mono font-medium text-white">
                    <a
                      href={`https://${r.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-indigo-400 inline-flex items-center gap-1.5"
                    >
                      <span>{r.domain}</span>
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </a>
                  </td>

                  <td className="px-5 py-3">
                    {r.isPaywalled ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                        Paywalled
                      </span>
                    ) : (
                      <span className="text-slate-500">Free / Open</span>
                    )}
                  </td>

                  <td className="px-5 py-3">
                    {r.optOut ? (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                        Opted Out
                      </span>
                    ) : (
                      <span className="text-slate-500">Standard</span>
                    )}
                  </td>

                  <td className="px-5 py-3 text-slate-400">{r.note}</td>

                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleDeleteRule(r.domain)}
                      className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
