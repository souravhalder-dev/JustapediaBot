import fs from "fs";
import path from "path";
import { fetchJustapediaPage, fetchCategoryMembers } from "./justapedia";
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
      "Nikola Tesla",
      "Grace Hopper",
      "Rosalind Franklin",
      "Alan Turing",
      "Ada Lovelace",
      "Tim Berners-Lee",
      "James Webb Space Telescope",
      "Hubble Space Telescope",
      "Apollo 11",
      "Voyager 1",
    ],
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

  constructor() {
    this.state = this.loadState();
    // Auto-resume if server was previously running when process restarted
    if (this.state.status === "RUNNING" || this.state.status === "PAUSED") {
      if (this.state.sessionToken) {
        this.addLog({
          level: "info",
          message: "Server restarted: Automatically resuming continuous background bot operation.",
        });
        setTimeout(() => this.startLoop(), 1000);
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
    const interval = 100;
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
    this.state.startedAt = new Date().toISOString();

    this.addLog({
      level: "info",
      message: `[STARTED] InternetArchiveBot server worker activated by @${params.operatorUsername}. Continuous processing engaged.`,
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
   * Trigger queue replenishment from Justapedia category crawling
   */
  public async replenishQueue(limit: number = 50, customCat?: string): Promise<number> {
    if (this.isReplenishing) return 0;
    this.isReplenishing = true;

    try {
      const cat = customCat || this.state.options.categoryInput || "Category:All articles with dead external links";
      const res = await fetchCategoryMembers(cat, limit);
      const members = res.members || [];

      let added = 0;
      const existingQueueSet = new Set(this.state.queue.map((t) => t.toLowerCase()));

      for (const title of members) {
        if (!title) continue;
        const norm = title.toLowerCase();
        // Exclude if already in queue or already verified clean
        if (!existingQueueSet.has(norm)) {
          const elig = isArticleEligibleForCheck(title);
          if (elig.eligible) {
            this.state.queue.push(title);
            existingQueueSet.add(norm);
            added++;
          }
        }
      }

      if (added > 0) {
        this.addLog({
          level: "info",
          message: `[QUEUE REPLENISHED] Added ${added} new unhandled article(s) from "${cat}". Queue depth: ${this.state.queue.length}.`,
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
    // Add to front of queue
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
   * Main Background Worker Loop:
   * Handles:
   * 1. Check once per article, resolve all issues in a single edit
   * 2. Skip unchanged articles unless revid changed on Justapedia
   * 3. 100 successful edits -> exactly 60s pause -> auto-resume cycle
   * 4. Instant cancellation on Stop
   */
  private async startLoop(): Promise<void> {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;
    this.stopRequested = false;

    try {
      while (!this.stopRequested && this.state.status !== "STOPPED") {
        const now = Date.now();

        // -------------------------------------------------------------
        // 1. COOLDOWN PAUSE HANDLING (60-second burst break)
        // -------------------------------------------------------------
        if (this.state.pauseUntil && now < this.state.pauseUntil) {
          await this.interruptibleSleep(500);
          continue;
        }

        // If cooldown break just ended, auto-resume next cycle
        if (this.state.status === "PAUSED" && this.state.pauseUntil && now >= this.state.pauseUntil) {
          this.state.pauseUntil = null;
          this.state.currentCycleEdits = 0;
          this.state.cycleNumber += 1;
          this.state.status = "RUNNING";

          this.addLog({
            level: "cycle",
            message: `[COOLDOWN FINISHED] 60-second break complete! Automatically resuming Cycle #${this.state.cycleNumber} for continuous 24/7/365 editing.`,
          });
          this.persistState();
        }

        if (this.stopRequested || this.state.status !== "RUNNING") break;

        // -------------------------------------------------------------
        // 2. QUEUE HEALTH & AUTO-REPLENISHMENT
        // -------------------------------------------------------------
        if (this.state.queue.length <= 5 && !this.isReplenishing) {
          await this.replenishQueue(50);
        }

        if (this.state.queue.length === 0) {
          this.addLog({
            level: "info",
            message: `[QUEUE IDLE] Awaiting next articles from category members...`,
          });
          await this.interruptibleSleep(3000);
          continue;
        }

        // Pop next article from queue
        const articleTitle = this.state.queue.shift()!;
        this.persistState();

        if (this.stopRequested) break;

        // -------------------------------------------------------------
        // 3. FETCH & DUPLICATE MODIFICATION SHIELD
        // -------------------------------------------------------------
        let page;
        try {
          page = await fetchJustapediaPage(articleTitle);
        } catch (fetchErr: any) {
          this.addLog({
            level: "warn",
            articleTitle,
            message: `Could not retrieve "${articleTitle}" from Justapedia API: ${fetchErr.message}`,
          });
          continue;
        }

        if (!page || !page.exists || !page.wikitext.trim()) {
          this.addLog({
            level: "warn",
            articleTitle,
            message: `Article "${articleTitle}" does not exist or has empty wikitext on Justapedia. Skipped.`,
          });
          continue;
        }

        const currentRevid = page.revisionId || 0;
        const eligibility = isArticleEligibleForCheck(articleTitle, currentRevid);

        // If article was already checked at this exact revision, skip immediately!
        if (!eligibility.eligible) {
          this.state.totalSkipped += 1;
          this.addLog({
            level: "info",
            articleTitle,
            message: `[DUPLICATE SHIELD] "${articleTitle}" (rev #${currentRevid}): ${eligibility.reason}`,
          });
          await this.interruptibleSleep(300);
          continue;
        }

        // -------------------------------------------------------------
        // 4. INSPECT & RESOLVE ALL ISSUES IN SINGLE CYCLE
        // -------------------------------------------------------------
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
          continue;
        }

        if (this.stopRequested) break;

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

          await this.interruptibleSleep(400);
          continue;
        }

        // CASE B: Issues found and repaired! Save the REAL fixed wikitext.
        if (!this.state.sessionToken) {
          this.addLog({
            level: "error",
            articleTitle,
            message: `Authentication required: Cannot save edits to "${articleTitle}". Operator session missing.`,
          });
          this.state.status = "STOPPED";
          break;
        }

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
          continue;
        }

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
            break;
          }
          continue;
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

        // -------------------------------------------------------------
        // 5. 100-EDIT BURST CHECK & AUTOMATIC 60S PAUSE
        // -------------------------------------------------------------
        if (this.state.currentCycleEdits >= 100) {
          this.state.status = "PAUSED";
          this.state.pauseUntil = Date.now() + 60000; // Exactly 60 seconds

          this.addLog({
            level: "cycle",
            message: `[BURST LIMIT REACHED] Completed 100 successful edits in Cycle #${this.state.cycleNumber}! Entering mandatory 60-second pause. Editing will automatically resume after the break.`,
          });

          this.persistState();
          continue;
        }

        // Pacing delay (500ms) between article operations
        await this.interruptibleSleep(500);
      }
    } finally {
      this.isLoopRunning = false;
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
