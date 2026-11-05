import Link from "next/link";
import { Bot, ExternalLink } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 text-slate-400 text-xs mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <span className="font-semibold text-white text-sm">Justapedia Bot Suite</span>
              <p className="text-[11px] text-slate-500">
                MediaWiki 1.45.3 Automated Suite • High-Speed 100 Edits/Min Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <a
              href="https://justapedia.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition inline-flex items-center gap-1"
            >
              <span>Justapedia.org</span>
              <ExternalLink className="w-3 h-3 text-slate-500" />
            </a>
            <span>•</span>
            <a
              href="https://justapedia.org/Special:BotPasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition inline-flex items-center gap-1"
            >
              <span>Bot Passwords</span>
              <ExternalLink className="w-3 h-3 text-slate-500" />
            </a>
          </div>

          <div className="text-[11px] text-slate-500">
            © {new Date().getFullYear()} Justapedia. Open Knowledge Preservation.
          </div>

        </div>
      </div>
    </footer>
  );
}
