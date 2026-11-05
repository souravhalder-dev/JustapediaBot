"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Circle, Globe, FileText, Search, Database, Sparkles } from "lucide-react";

interface Step {
  id: string;
  label: string;
  icon: any;
}

const STEPS: Step[] = [
  { id: "fetch", label: "Querying Justapedia API", icon: Globe },
  { id: "parse", label: "Extracting External Links & Citations", icon: FileText },
  { id: "health", label: "Checking Live HTTP Status & Link Rot", icon: Search },
  { id: "wayback", label: "Querying Wayback Machine Snapshots", icon: Database },
  { id: "diff", label: "Generating Wikitext Rescues & Diffs", icon: Sparkles },
];

export function ScanProgress({ currentStep = 2 }: { currentStep?: number }) {
  return (
    <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
          <span>Analyzing Justapedia Page...</span>
        </h4>
        <span className="text-xs text-indigo-400 font-mono">Step {Math.min(currentStep, STEPS.length)} of {STEPS.length}</span>
      </div>

      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isDone = idx < currentStep;
          const isCurrent = idx === currentStep;

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`flex items-center gap-3 p-3 rounded-xl border text-xs transition-all duration-200 ${
                isCurrent
                  ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-300 font-medium"
                  : isDone
                  ? "bg-slate-950/40 border-slate-800 text-slate-300"
                  : "bg-slate-950/20 border-slate-900 text-slate-600"
              }`}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : isCurrent ? (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-slate-700" />
                )}
              </div>
              <Icon className={`w-4 h-4 ${isCurrent ? "text-indigo-400" : isDone ? "text-slate-400" : "text-slate-700"}`} />
              <span className="flex-1">{step.label}</span>
              {isDone && <span className="text-[10px] text-emerald-400 font-mono">Done</span>}
              {isCurrent && <span className="text-[10px] text-indigo-400 font-mono animate-pulse">Running</span>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
