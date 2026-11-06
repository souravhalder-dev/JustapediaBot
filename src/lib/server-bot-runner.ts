import fs from "fs";
import path from "path";
import { fetchJustapediaPage, fetchCategoryMembers, fetchTemplateTransclusions } from "./justapedia";
import { processArticleWithIABot, IABotRunOptions, IABotStats } from "./iabot-engine";
import { executeJustapediaEdit } from "./save-engine";
import { isArticleEligibleForCheck, recordArticleCheck } from "./article-history";

export type BotRunnerStatus = "RUNNING" | "PAUSED" | "STOPPED";

export interface BotRunnerLog {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error" | "cycle";
  articleTitle?: string;
  message: string;
  diffUrl?: string;
}

export interface BotRunnerState {
  botId: string;
  status: BotRunnerStatus;
  operatorUsername: string;
  sessionToken: string;
  currentCycleEdits: number; // 0 to 100
  cycleNumber: number; // 1, 2, 3...
  pauseUntil: number | null; // epoch ms when paused
  totalEdits: number;
  totalChecked: number;
  totalSkipped: number;
  totalErrors: number;
  queue: string[];
  activeArticle: string | null;
  activePhase: string | null;
  options: {
    useSandbox: boolean;
    archiveWorkingLinks: boolean;
    repairBrokenArchives: boolean;
    tagUnrecoverableDead: boolean;
    maxLinksPerPage: number;
    categoryInput: string;
  };
  detailedStats: IABotStats & {
    articlesProcessed: number;
    failedOperations: number;
  };
  logs: BotRunnerLog[];
  startedAt: string | null;
  lastActiveAt: string;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "bot-runner-state.json");

// Default initial state
function createDefaultState(): BotRunnerState {
  return {
    botId: "internet-bot",
    status: "STOPPED",
    operatorUsername: "",
    sessionToken: "",
    currentCycleEdits: 0,
    cycleNumber: 1,
    pauseUntil: null,
    totalEdits: 0,
    totalChecked: 0,
    totalSkipped: 0,
    totalErrors: 0,
    queue: [
      "Academy Awards",
      "Andre Agassi",
      "Andorra",
      "Animal Farm",
      "Amphibian",
      "Astronaut",
      "Atlantic Ocean",
      "Angola",
      "James Webb Space Telescope",
      "Hubble Space Telescope",
    ],
    activeArticle: null,
    activePhase: "Idle",
    options: {
      useSandbox: false,
      archiveWorkingLinks: false,
      repairBrokenArchives: true,
      tagUnrecoverableDead: true,
      maxLinksPerPage: 50,
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
    logs: [
      {
        id: "init-1",
        timestamp: new Date().toLocaleTimeString(),
        level: "info",
        message: "InternetArchiveBot server runner initialized and ready.",
      },
    ],
    startedAt: null,
    lastActiveAt: new Date().toISOString(),
  };
}

class ServerBotRunner {
  private state: BotRunnerState;
  private stopRequested: boolean = false;
  private isLoopRunning: boolean = false;
  private isReplenishing: boolean = false;
  private continueTokens: Map<string, string> = new Map();
  private sessionProcessedTitles: Set<string> = new Set();

  constructor() {
    this.state = this.loadState();
    // Auto-resume if server was previously running when process restarted
    if (this.state.status === "RUNNING" || this.state.status === "PAUSED") {
      if (this.state.sessionToken) {
        this.addLog({
          level: "info",
          message: "Server restarted: Automatically resuming continuous background bot operation.",
        });
        setTimeout(() => this.startLoop(), 500);
      } else {
        this.state.status = "STOPPED";
        this.persistState();
      }
    }
  }

  private loadState(): BotRunnerState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          ...createDefaultState(),
          ...parsed,
          activeArticle: null,
          activePhase: "Idle",
          options: {
            ...createDefaultState().options,
            ...(parsed.options || {}),
          },
          detailedStats: {
            ...createDefaultState().detailedStats,
            ...(parsed.detailedStats || {}),
          },
        };
      }
    } catch (err) {
      console.warn("[SERVER RUNNER] Failed to load persisted state, using default:", err);
    }
    return createDefaultState();
  }

  private persistState(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      this.state.lastActiveAt = new Date().toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      // Graceful fallback for read-only environments
    }
  }

  public addLog(entry: Omit<BotRunnerLog, "id" | "timestamp">): void {
    const log: BotRunnerLog = {
      id: "log-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toLocaleTimeString(),
      ...entry,
    };
    this.state.logs.unshift(log);
    // Keep max 250 logs in memory/disk
    if (this.state.logs.length > 250) {
      this.state.logs = this.state.logs.slice(0, 250);
    }
    this.persistState();
  }

  private async interruptibleSleep(ms: number): Promise<void> {
    const interval = 25;
    const steps = Math.ceil(ms / interval);
    for (let i = 0; i < steps; i++) {
      if (this.stopRequested || this.state.status === "STOPPED") break;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /**
   * Start the continuous autonomous background worker
   */
  public async start(params: {
    sessionToken: string;
    operatorUsername: string;
    options?: Partial<BotRunnerState["options"]>;
  }): Promise<{ success: boolean; status: BotRunnerStatus; message: string }> {
    this.stopRequested = false;
    this.state.sessionToken = params.sessionToken;
    this.state.operatorUsername = params.operatorUsername;

    if (params.options) {
      this.state.options = { ...this.state.options, ...params.options };
    }

    this.state.status = "RUNNING";
    this.state.pauseUntil = null;
    this.state.activeArticle = null;
    this.state.activePhase = "Starting";
    this.state.startedAt = new Date().toISOString();

    this.addLog({
      level: "info",
      message: `[STARTED] InternetArchiveBot activated by @${params.operatorUsername}. High-speed 100 edits/min worker pool engaged.`,
    });

    this.persistState();
    this.startLoop();

    return {
      success: true,
      status: this.state.status,
      message: "InternetArchiveBot started successfully on server.",
    };
  }

  /**
   * Stop the bot immediately.
   * Works at any time: during active processing, during 60s cooldown, or between edits.
   */
  public stop(): { success: boolean; status: BotRunnerStatus; message: string } {
    this.stopRequested = true;
    this.state.status = "STOPPED";
    this.state.pauseUntil = null;
    this.state.activeArticle = null;
    this.state.activePhase = "Stopped";

    this.addLog({
      level: "warn",
      message: `[STOPPED] Operator clicked Stop. All ongoing and scheduled activities halted immediately.`,
    });

    this.persistState();

    return {
      success: true,
      status: "STOPPED",
      message: "Bot stopped immediately.",
    };
  }

  /**
   * Trigger queue replenishment from Justapedia category crawling or template transclusions
   * Tracks cmcontinue and eicontinue pagination to iterate sequentially across the whole wiki
   */
  public async replenishQueue(limit: number = 50, customSource?: string): Promise<number> {
    if (this.isReplenishing) return 0;
    this.isReplenishing = true;

    try {
      const source =
        customSource ||
        this.state.options.categoryInput ||
        "Category:All articles with dead external links";

      const currentToken = this.continueTokens.get(source);
      let members: string[] = [];

      if (source.toLowerCase().startsWith("template:")) {
        const res = await fetchTemplateTransclusions(source, limit, currentToken);
        members = res.members || [];
        if (res.eicontinue) {
          this.continueTokens.set(source, res.eicontinue);
        } else {
          this.continueTokens.delete(source);
        }
      } else {
        const res = await fetchCategoryMembers(source, limit, currentToken);
        members = res.members || [];
        if (res.cmcontinue) {
          this.continueTokens.set(source, res.cmcontinue);
        } else {
          this.continueTokens.delete(source);
        }
      }

      // If category members was small or end reached, supplement with active Template:Dead link articles on Justapedia
      if (members.length < 20 && !source.toLowerCase().startsWith("template:")) {
        const tplToken = this.continueTokens.get("Template:Dead link");
        const tplRes = await fetchTemplateTransclusions("Template:Dead link", limit, tplToken);
        members = [...members, ...(tplRes.members || [])];
        if (tplRes.eicontinue) {
          this.continueTokens.set("Template:Dead link", tplRes.eicontinue);
        } else {
          this.continueTokens.delete("Template:Dead link");
        }
      }

      let added = 0;
      for (const m of members) {
        const normM = m.trim().toLowerCase();
        if (!this.state.queue.includes(m) && !this.sessionProcessedTitles.has(normM)) {
          const eligibility = isArticleEligibleForCheck(m);
          if (eligibility.eligible) {
            this.state.queue.push(m);
            added++;
          }
        }
      }

      if (added > 0) {
        this.addLog({
          level: "info",
          message: `[QUEUE REPLENISHED] Added ${added} new unhandled article(s) from "${source}". Queue depth: ${this.state.queue.length}.`,
        });
      }

      this.persistState();
      return added;
    } catch (err: any) {
      console.error("[REPLENISH ERROR]", err);
      return 0;
    } finally {
      this.isReplenishing = false;
    }
  }

  public addArticle(title: string): boolean {
    const clean = title.trim();
    if (!clean) return false;
    this.state.queue.unshift(clean);
    this.addLog({
      level: "info",
      articleTitle: clean,
      message: `Manually added "${clean}" to the top of the processing queue.`,
    });
    this.persistState();
    return true;
  }

  public clearQueue(): void {
    const count = this.state.queue.length;
    this.state.queue = [];
    this.addLog({
      level: "info",
      message: `Cleared ${count} item(s) from the pending queue.`,
    });
    this.persistState();
  }

  public resetStats(): void {
    this.state.currentCycleEdits = 0;
    this.state.cycleNumber = 1;
    this.state.totalEdits = 0;
    this.state.totalChecked = 0;
    this.state.totalSkipped = 0;
    this.state.totalErrors = 0;
    this.state.activeArticle = null;
    this.state.activePhase = "Idle";
    this.state.detailedStats = {
      articlesProcessed: 0,
      referencesChecked: 0,
      deadLinksDetected: 0,
      archiveLinksAdded: 0,
      archiveLinksRepaired: 0,
      newSnapshotsRequested: 0,
      unrecoverableLinksTagged: 0,
      articlesModified: 0,
      failedOperations: 0,
    };
    this.addLog({
      level: "info",
      message: "Reset all bot performance statistics and burst cycle counters.",
    });
    this.persistState();
  }

  public updateOptions(options: Partial<BotRunnerState["options"]>): void {
    this.state.options = { ...this.state.options, ...options };
    this.addLog({
      level: "info",
      message: "Updated bot operating configuration.",
    });
    this.persistState();
  }

  public getState() {
    const now = Date.now();
    let cooldownRemainingSeconds = 0;

    if (this.state.status === "PAUSED" && this.state.pauseUntil) {
      cooldownRemainingSeconds = Math.max(0, Math.ceil((this.state.pauseUntil - now) / 1000));
    }

    return {
      ...this.state,
      cooldownRemainingSeconds,
      isLoopRunning: this.isLoopRunning,
    };
  }

  /**
   * Process a single article systematically:
   * 1. Check revision ID against persistent history (duplicate shield).
   * 2. Inspect all references in a single pass.
   * 3. If zero issues -> do NOT edit, mark verified clean.
   * 4. If issues found -> commit edit under authenticated user, increment cycle edits.
   * 5. If edit fails -> do NOT increment successful edits count.
   */
  private async processSingleArticle(articleTitle: string): Promise<boolean> {
    if (this.stopRequested || this.state.status !== "RUNNING") return false;

    // 1. Fetch Page
    let page;
    try {
      page = await fetchJustapediaPage(articleTitle);
    } catch (fetchErr: any) {
      this.addLog({
        level: "warn",
        articleTitle,
        message: `Could not retrieve "${articleTitle}" from Justapedia API: ${fetchErr.message}`,
      });
      return false;
    }

    if (!page || !page.exists || !page.wikitext.trim()) {
      return false;
    }

    this.sessionProcessedTitles.add(articleTitle.trim().toLowerCase());

    const currentRevid = page.revisionId || 0;
    const eligibility = isArticleEligibleForCheck(articleTitle, currentRevid, page.wikitext);

    // 2. Duplicate Check Shield: If all citations have archive links and zero dead links remain, skip cleanly
    if (!eligibility.eligible) {
      this.state.totalSkipped += 1;
      this.addLog({
        level: "info",
        articleTitle,
        message: `[PROPERLY FIXED] "${articleTitle}" (rev #${currentRevid}): ${eligibility.reason}`,
      });
      return false;
    }

    if (this.stopRequested || this.state.status !== "RUNNING") return false;

    // 3. Process article citations with IABot engine
    this.state.activeArticle = articleTitle;
    this.state.activePhase = "Inspecting citations";

    let botResult;
    try {
      botResult = await processArticleWithIABot(articleTitle, {
        archiveWorkingLinks: this.state.options.archiveWorkingLinks,
        repairBrokenArchives: this.state.options.repairBrokenArchives,
        tagUnrecoverableDead: this.state.options.tagUnrecoverableDead,
        maxLinksPerPage: this.state.options.maxLinksPerPage,
        useSandbox: this.state.options.useSandbox,
      });
    } catch (procErr: any) {
      this.state.totalErrors += 1;
      this.state.detailedStats.failedOperations += 1;
      this.addLog({
        level: "error",
        articleTitle,
        message: `Processing error on "${articleTitle}": ${procErr.message || String(procErr)}`,
      });
      return false;
    }

    if (this.stopRequested || this.state.status !== "RUNNING") return false;

    // CASE A: No issues identified (article is clean/healthy)
    // Rule: DO NOT EDIT. Mark verified clean and do not touch.
    if (!botResult.modified || !botResult.fixedWikitext) {
      recordArticleCheck({
        title: articleTitle,
        revid: currentRevid,
        botId: this.state.botId,
        status: "verified_healthy",
        issuesFound: 0,
        issuesFixed: 0,
        summary: botResult.details.join(" • ") || "Verified clean citations. Zero dead links.",
      });

      this.state.totalChecked += 1;
      this.state.detailedStats.articlesProcessed += 1;
      this.state.detailedStats.referencesChecked += botResult.stats.referencesChecked;

      this.addLog({
        level: "info",
        articleTitle,
        message: `[VERIFIED HEALTHY] "${articleTitle}" (${botResult.stats.referencesChecked} refs inspected). Zero issues found. Skipped without modifying.`,
      });

      return false;
    }

    // CASE B: Issues found and repaired! Save the REAL fixed wikitext.
    if (!this.state.sessionToken) {
      this.addLog({
        level: "error",
        articleTitle,
        message: `Authentication required: Cannot save edits to "${articleTitle}". Operator session missing.`,
      });
      this.state.status = "STOPPED";
      return false;
    }

    this.state.activePhase = "Saving to Justapedia";

    const editSummary =
      botResult.summary ||
      `InternetArchiveBot: Rescued references & verified citations (${this.state.operatorUsername})`;

    let saveRes;
    try {
      saveRes = await executeJustapediaEdit(this.state.sessionToken, {
        title: articleTitle,
        wikitext: botResult.fixedWikitext,
        summary: editSummary,
        use_sandbox: this.state.options.useSandbox,
        sandbox_title:
          this.state.options.useSandbox && this.state.operatorUsername
            ? `User:${this.state.operatorUsername}/sandbox`
            : undefined,
        is_minor: false,
        is_bot: false,
      });
    } catch (saveErr: any) {
      this.state.totalErrors += 1;
      this.state.detailedStats.failedOperations += 1;
      this.addLog({
        level: "error",
        articleTitle,
        message: `Save exception on "${articleTitle}": ${saveErr.message || String(saveErr)}`,
      });
      return false;
    }

    // Rule: Do not count failed edits as successful edits.
    if (!saveRes.success) {
      this.state.totalErrors += 1;
      this.state.detailedStats.failedOperations += 1;
      this.addLog({
        level: "error",
        articleTitle,
        message: `Failed to save "${articleTitle}": ${saveRes.message}`,
      });

      if (saveRes.message?.includes("Authentication") || saveRes.message?.includes("expired")) {
        this.state.status = "STOPPED";
        this.addLog({
          level: "error",
          message: `[SESSION EXPIRED] Operator login credentials have expired. Bot halted. Please re-login.`,
        });
      }
      return false;
    }

    // Record successful resolution in history
    const newRevid = saveRes.revid || currentRevid;
    const totalFixed =
      botResult.stats.archiveLinksAdded +
      botResult.stats.archiveLinksRepaired +
      botResult.stats.unrecoverableLinksTagged;

    recordArticleCheck({
      title: articleTitle,
      revid: currentRevid,
      botId: this.state.botId,
      status: "edited_and_resolved",
      issuesFound: totalFixed,
      issuesFixed: totalFixed,
      revidSaved: newRevid,
      diffUrl: saveRes.diff_url,
      summary: editSummary,
    });

    // Only count as successful edit if saveRes.success === true
    this.state.totalChecked += 1;
    this.state.totalEdits += 1;
    this.state.currentCycleEdits += 1;
    this.state.detailedStats.articlesProcessed += 1;
    this.state.detailedStats.articlesModified += 1;
    this.state.detailedStats.referencesChecked += botResult.stats.referencesChecked;
    this.state.detailedStats.deadLinksDetected += botResult.stats.deadLinksDetected;
    this.state.detailedStats.archiveLinksAdded += botResult.stats.archiveLinksAdded;
    this.state.detailedStats.archiveLinksRepaired += botResult.stats.archiveLinksRepaired;
    this.state.detailedStats.newSnapshotsRequested += botResult.stats.newSnapshotsRequested;
    this.state.detailedStats.unrecoverableLinksTagged += botResult.stats.unrecoverableLinksTagged;

    this.addLog({
      level: "success",
      articleTitle,
      message: `[EDIT #${this.state.currentCycleEdits}/100 SAVED] "${articleTitle}" updated on Justapedia (rev #${newRevid}). Added ${botResult.stats.archiveLinksAdded} archive(s), repaired ${botResult.stats.archiveLinksRepaired} link(s).`,
      diffUrl: saveRes.diff_url,
    });

    this.persistState();
    return true;
  }

  /**
   * Main High-Performance Autonomous Worker Pool:
   * Handles:
   * 1. Up to 6 concurrent article workers for rapid edit throughput (up to 100 edits/min).
   * 2. Exactly 100 successful edits -> mandatory 60s rest break -> auto-resume Cycle #(N+1).
   * 3. Immediate cancellation on Stop.
   * 4. Zero duplicate edits, zero unnecessary edits.
   */
  private async startLoop(): Promise<void> {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;
    this.stopRequested = false;

    const CONCURRENCY = 8;
    const activeWorkers = new Set<Promise<void>>();
    const inProgressArticles = new Set<string>();

    try {
      while (!this.stopRequested && this.state.status !== "STOPPED") {
        const now = Date.now();

        // -------------------------------------------------------------
        // 1. COOLDOWN PAUSE HANDLING (60-second burst break)
        // -------------------------------------------------------------
        if (this.state.pauseUntil && now < this.state.pauseUntil) {
          this.state.activeArticle = null;
          this.state.activePhase = "Rest Break (60s)";
          await this.interruptibleSleep(200);
          continue;
        }

        // If cooldown break just ended, auto-resume next cycle
        if (this.state.status === "PAUSED" && this.state.pauseUntil && now >= this.state.pauseUntil) {
          this.state.pauseUntil = null;
          this.state.currentCycleEdits = 0;
          this.state.cycleNumber += 1;
          this.state.status = "RUNNING";
          this.state.activePhase = "Resuming";

          this.addLog({
            level: "cycle",
            message: `[COOLDOWN FINISHED] 60-second break complete! Automatically resuming Cycle #${this.state.cycleNumber} for continuous 24/7/365 editing.`,
          });
          this.persistState();
        }

        if (this.stopRequested || this.state.status !== "RUNNING") break;

        // -------------------------------------------------------------
        // 2. BURST LIMIT CHECK (100 successful edits -> enter 60s pause)
        // -------------------------------------------------------------
        if (this.state.currentCycleEdits >= 100) {
          this.state.status = "PAUSED";
          this.state.pauseUntil = Date.now() + 60000; // exactly 60 seconds
          this.state.activeArticle = null;
          this.state.activePhase = "60s Rest Break";

          this.addLog({
            level: "cycle",
            message: `[BURST LIMIT REACHED] Completed 100 successful edits in Cycle #${this.state.cycleNumber}! Entering mandatory 60-second pause. Editing will automatically resume after the break.`,
          });
          this.persistState();

          // Wait for any remaining in-flight tasks to finish
          await Promise.all(activeWorkers);
          continue;
        }

        // -------------------------------------------------------------
        // 3. QUEUE REPLENISHMENT
        // -------------------------------------------------------------
        if (this.state.queue.length <= 15 && !this.isReplenishing) {
          this.replenishQueue(50);
        }

        if (this.state.queue.length === 0) {
          if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
            continue;
          }
          this.state.activeArticle = null;
          this.state.activePhase = "Awaiting articles";
          await this.replenishQueue(50);
          if (this.state.queue.length === 0) {
            await this.interruptibleSleep(1200);
            continue;
          }
        }

        // -------------------------------------------------------------
        // 4. CONCURRENCY THROTTLE
        // -------------------------------------------------------------
        if (activeWorkers.size >= CONCURRENCY) {
          await Promise.race(activeWorkers);
          continue;
        }

        // -------------------------------------------------------------
        // 5. DISPATCH NEXT ARTICLE
        // -------------------------------------------------------------
        const nextTitle = this.state.queue.shift();
        if (!nextTitle) continue;
        if (inProgressArticles.has(nextTitle)) continue;

        inProgressArticles.add(nextTitle);
        this.persistState();

        const workerPromise = (async () => {
          try {
            await this.processSingleArticle(nextTitle);
          } finally {
            inProgressArticles.delete(nextTitle);
          }
        })();

        activeWorkers.add(workerPromise);
        workerPromise.finally(() => {
          activeWorkers.delete(workerPromise);
        });

        // Yield slightly so loop doesn't block the Node event loop
        await this.interruptibleSleep(20);
      }

      // Wait for all in-flight workers to gracefully resolve
      await Promise.all(activeWorkers);
    } finally {
      this.isLoopRunning = false;
      this.state.activeArticle = null;
      this.state.activePhase = "Stopped";
      this.persistState();
    }
  }
}

// Global singleton instance preserved across Next.js reloads
declare global {
  var __justapediaBotRunnerInstance__: ServerBotRunner | undefined;
}

export function getServerBotRunner(): ServerBotRunner {
  if (!globalThis.__justapediaBotRunnerInstance__) {
    globalThis.__justapediaBotRunnerInstance__ = new ServerBotRunner();
  }
  return globalThis.__justapediaBotRunnerInstance__;
}
