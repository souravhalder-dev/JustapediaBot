export type LinkStatus = 'alive' | 'dead' | 'redirect' | 'unknown' | 'error';

export interface ExtractedLink {
  id: string;
  url: string;
  domain: string;
  linkType: 'reference' | 'template' | 'bare' | 'external';
  templateName?: string;
  rawString: string;
  status: LinkStatus;
  httpCode?: number;
  error?: string;
  waybackSnapshot?: {
    available: boolean;
    url: string;
    timestamp: string;
    status: string;
  } | null;
  proposedFix?: {
    action: 'add_archive' | 'modify_archive' | 'tag_dead' | 'none';
    newString: string;
    description: string;
  };
}

export interface PageAnalysisResult {
  pageTitle: string;
  pageId: number;
  lastRevisionId?: number;
  lastModified?: string;
  originalWikitext: string;
  fixedWikitext: string;
  hasModifications: boolean;
  links: ExtractedLink[];
  stats: {
    totalLinks: number;
    aliveLinks: number;
    deadLinks: number;
    rescuedLinks: number;
    taggedLinks: number;
  };
  durationMs: number;
}

export interface UrlCheckResult {
  url: string;
  domain: string;
  status: LinkStatus;
  httpCode?: number;
  finalUrl?: string;
  latencyMs: number;
  waybackSnapshot?: {
    available: boolean;
    url: string;
    timestamp: string;
    status: string;
  } | null;
  checkedAt: string;
}

export interface BotSettings {
  defaultTags: {
    deadLink: string;
    webArchive: string;
    noBots: string;
  };
  archivePreference: 'closest_date' | 'newest';
  checkAliveLinks: boolean;
  tagOnly: boolean;
  editSummary: string;
  customUserAgent: string;
}

// -------------------------------------------------------------
// User Authentication & Contribution Attribution Types
// -------------------------------------------------------------
export interface AuthUser {
  logged_in: boolean;
  username: string | null;
  userid?: number;
  editcount?: number;
  groups?: string[];
  rights?: string[];
  auth_type?: 'credentials' | 'oauth';
  userContributionsUrl?: string;
  userProfileUrl?: string;
}

export interface LoginResponse {
  success: boolean;
  message?: string;
  session_token?: string;
  username?: string;
  auth_type?: 'credentials' | 'oauth';
  user?: AuthUser;
}

// -------------------------------------------------------------
// Consistent Saving Mechanism Types (Birth Update Bot Compatible)
// -------------------------------------------------------------
export interface SaveArticleRequest {
  title: string;
  wikitext: string;
  summary: string;
  basetimestamp?: string;
  is_minor?: boolean;
  is_bot?: boolean;
  use_sandbox?: boolean;
  sandbox_title?: string;
}

export interface SaveArticleResponse {
  success: boolean;
  title: string;
  revid?: number;
  url?: string;
  diff_url?: string;
  editor?: string;
  is_sandbox?: boolean;
  message: string;
  user_contributions_url?: string;
  raw_response?: any;
}

// -------------------------------------------------------------
// Multiple Bot Management & Terminal Types
// -------------------------------------------------------------
export type BotLogLevel = 'info' | 'success' | 'warn' | 'error' | 'cycle' | 'auth';

export interface BotTerminalLog {
  id: string;
  timestamp: string;
  botId: string;
  level: BotLogLevel;
  message: string;
  articleTitle?: string;
  diffUrl?: string;
  revid?: number;
}

export type BotRunStatus = 'OFF' | 'ON' | 'PAUSED';

export interface BotDefinition {
  number: number;
  id: string;
  name: string;
  tagline: string;
  version: string;
  description: string;
  category: 'Citation & Links' | 'Biographical & Facts' | 'Content & Maintenance' | 'Formatting';
  capabilities: string[];
  defaultConfig: Record<string, any>;
  iconName: string;
}

export interface IABotDetailedStats {
  articlesProcessed: number;
  referencesChecked: number;
  deadLinksDetected: number;
  archiveLinksAdded: number;
  archiveLinksRepaired: number;
  newSnapshotsRequested: number;
  unrecoverableLinksTagged: number;
  articlesModified: number;
  failedOperations: number;
}

export interface BotState {
  botId: string;
  status: BotRunStatus;
  totalEdits: number;
  sessionEdits: number;
  currentCycleEdits: number; // Max 100 before pause
  targetEditsPerMinute: number; // e.g. 100
  isCooldown: boolean;
  cooldownRemainingSeconds: number; // 60s countdown
  cycleNumber: number;
  lastArticleProcessed?: string;
  lastEditTimestamp?: string;
  logs: BotTerminalLog[];
  articleQueue: string[];
  processedCount: number;
  successCount: number;
  errorCount: number;
  detailedStats?: IABotDetailedStats;
}
