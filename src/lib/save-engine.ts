import { SaveArticleRequest, SaveArticleResponse } from "./types";
import { formatCookieHeader, verifyUserSession } from "./auth";
import { executeBridgeRequest } from "./justapedia-bridge";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface SessionAuthCacheEntry {
  actualUsername: string;
  hasBotPermission: boolean;
  hasCleanTalkBypass: boolean;
  csrfToken: string;
  timestamp: number;
}

const sessionAuthCache = new Map<string, SessionAuthCacheEntry>();
const SESSION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL

/**
 * Consistent Saving Mechanism matching the Birth Update Bot (justapedia_client.py)
 * 
 * Guarantees that:
 * 1. Only authenticated user sessions are accepted.
 * 2. MediaWiki explicitly verifies the user's identity before any edit.
 * 3. The CSRF token is retrieved under that specific user's session cookies.
 * 4. The edit is committed using the user's authenticated cookies so it is
 *    properly recorded in their user contribution history on Justapedia.
 * 5. In Sandbox Mode, writes to the user's personal sandbox User:<username>/sandbox
 *    (preventing Project namespace Lockdown issues).
 * 6. Handles extension hooks gracefully with automatic retries and actionable diagnostics.
 */
export async function executeJustapediaEdit(
  sessionToken: string,
  request: SaveArticleRequest
): Promise<SaveArticleResponse> {
  const {
    title,
    wikitext,
    summary,
    basetimestamp,
    is_minor = false,
    is_bot = false,
    use_sandbox = false,
    sandbox_title,
  } = request;

  // 1. Verify user session token
  if (!sessionToken) {
    return {
      success: false,
      title: title.trim(),
      message: "Authentication required: You must be logged in with your Justapedia account to save edits.",
    };
  }

  const verification = await verifyUserSession(sessionToken);
  if (!verification.valid || !verification.session || !verification.user) {
    return {
      success: false,
      title: title.trim(),
      message: verification.error || "Authentication failed: Session invalid or expired. Please re-authenticate.",
    };
  }

  const { cookies } = verification.session;
  const cookieHeader = formatCookieHeader(cookies);
  const expectedUsername = verification.user.username;

  try {
    const now = Date.now();
    let auth = sessionAuthCache.get(sessionToken);

    if (!auth || now - auth.timestamp > SESSION_CACHE_TTL) {
      // Fetch userinfo
      const userinfoResp = await executeBridgeRequest<{
        query?: {
          userinfo?: {
            name?: string;
            anon?: boolean | string;
            rights?: string[];
            groups?: string[];
          };
        };
      }>({
        method: "GET",
        params: {
          action: "query",
          meta: "userinfo",
          uiprop: "groups|rights",
          format: "json",
        },
        cookies,
      });

      if (userinfoResp.status !== 200 || !userinfoResp.data) {
        return {
          success: false,
          title: title.trim(),
          message: `Justapedia API returned HTTP ${userinfoResp.status} during user verification: ${userinfoResp.error || ""}`,
        };
      }

      const uinfo = userinfoResp.data?.query?.userinfo;
      const actualUsername: string = uinfo?.name || "";
      const isAnon = !uinfo || Boolean(uinfo.anon);

      if (isAnon || !actualUsername) {
        return {
          success: false,
          title: title.trim(),
          message: "Authentication failed: Justapedia session cookies have expired. Please log in again.",
          raw_response: uinfo,
        };
      }

      const userRights: string[] = Array.isArray(uinfo?.rights) ? uinfo.rights : [];
      const userGroups: string[] = Array.isArray(uinfo?.groups) ? uinfo.groups : [];
      const hasBotPermission = userRights.includes("bot") || userGroups.includes("bot");
      const hasCleanTalkBypass = userRights.includes("cleantalk-bypass");

      if (expectedUsername && actualUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
        return {
          success: false,
          title: title.trim(),
          message: `Authentication mismatch: MediaWiki authenticated as '${actualUsername}' instead of '${expectedUsername}'. Please log in again.`,
          raw_response: uinfo,
        };
      }

      // Fetch CSRF token
      const tokenResp = await executeBridgeRequest<{
        query?: {
          tokens?: {
            csrftoken?: string;
          };
        };
      }>({
        method: "GET",
        params: {
          action: "query",
          meta: "tokens",
          type: "csrf",
          format: "json",
        },
        cookies,
      });

      if (tokenResp.status !== 200 || !tokenResp.data) {
        return {
          success: false,
          title: title.trim(),
          message: `Failed to connect to Justapedia to obtain CSRF token (HTTP ${tokenResp.status}): ${tokenResp.error || ""}`,
        };
      }

      const csrfToken = tokenResp.data?.query?.tokens?.csrftoken;

      if (!csrfToken || csrfToken === "+\\") {
        return {
          success: false,
          title: title.trim(),
          message: "Failed to retrieve valid CSRF token with session cookies. Please re-authenticate.",
          raw_response: tokenResp.data,
        };
      }

      auth = {
        actualUsername,
        hasBotPermission,
        hasCleanTalkBypass,
        csrfToken,
        timestamp: now,
      };
      sessionAuthCache.set(sessionToken, auth);
    }

    const { actualUsername, hasBotPermission, hasCleanTalkBypass, csrfToken } = auth;

    // Determine target title and wikitext
    let targetTitle = title.trim();
    let textToSave = wikitext;
    let finalSummary = summary.trim();

    if (use_sandbox) {
      targetTitle = sandbox_title || `User:${actualUsername}/sandbox`;
      textToSave = `<!-- TEST DRAFT FOR [${title}] VIA JUSTAPEDIA BOT SUITE -->\n{{Please leave this line alone (sandbox heading)}}\n\n${wikitext}`;
      finalSummary = `[TEST] Draft for ${title}: ${summary}`;
    }

    // Submit edit under the logged-in user's account via Cloudflare-bypass bridge
    const sendEditPost = async (params: {
      titleToUse: string;
      textToUse: string;
      summaryToUse: string;
      withBotFlag: boolean;
      withMinorFlag: boolean;
      tokenToUse: string;
    }) => {
      const editData: Record<string, string> = {
        action: "edit",
        title: params.titleToUse,
        text: params.textToUse,
        summary: params.summaryToUse,
        token: params.tokenToUse,
        format: "json",
        formatversion: "2",
        errorformat: "plaintext",
      };

      if (params.withMinorFlag) editData.minor = "1";
      if (params.withBotFlag) editData.bot = "1";
      if (basetimestamp && !use_sandbox) {
        editData.basetimestamp = basetimestamp;
      }

      const res = await executeBridgeRequest<any>({
        method: "POST",
        data: editData,
        cookies,
      });

      if (res.status !== 200 || !res.data) {
        throw new Error(`Justapedia edit POST failed with HTTP ${res.status}: ${res.error || ""}`);
      }

      return res.data;
    };

    // Attempt edit
    let sentWithBot = Boolean(is_bot && hasBotPermission);
    let data = await sendEditPost({
      titleToUse: targetTitle,
      textToUse: textToSave,
      summaryToUse: finalSummary,
      withBotFlag: sentWithBot,
      withMinorFlag: Boolean(is_minor),
      tokenToUse: csrfToken,
    });

    console.log(`[JUSTAPEDIA EDIT ATTEMPT] target: "${targetTitle}", editor: "${actualUsername}", botFlag: ${sentWithBot}`);

    // 5. Inspect response and handle errors
    let errorsList = Array.isArray(data?.errors) ? data.errors : (data?.error ? [data.error] : []);

    // Automatic Hook-Abort Recovery:
    // If aborted and bot=1 was passed, retry immediately WITHOUT bot flag
    if (errorsList.length > 0 && errorsList[0]?.code === "hookaborted" && sentWithBot) {
      console.warn(`[EDIT RETRY] hookaborted with bot=1. Retrying without bot flag as direct user edit...`);
      sentWithBot = false;
      data = await sendEditPost({
        titleToUse: targetTitle,
        textToUse: textToSave,
        summaryToUse: finalSummary,
        withBotFlag: false,
        withMinorFlag: Boolean(is_minor),
        tokenToUse: csrfToken,
      });
      errorsList = Array.isArray(data?.errors) ? data.errors : (data?.error ? [data.error] : []);
    }

    // Automatic Sandbox Recovery:
    // If sandbox was set to Justapedia:Sandbox and failed with hookaborted, retry to User:<actualUsername>/sandbox
    if (errorsList.length > 0 && errorsList[0]?.code === "hookaborted" && use_sandbox && targetTitle === "Justapedia:Sandbox") {
      const personalSandbox = `User:${actualUsername}/sandbox`;
      console.warn(`[EDIT RETRY] Justapedia:Sandbox aborted by extension. Retrying on personal sandbox: "${personalSandbox}"...`);
      targetTitle = personalSandbox;
      data = await sendEditPost({
        titleToUse: personalSandbox,
        textToUse: textToSave,
        summaryToUse: finalSummary,
        withBotFlag: sentWithBot,
        withMinorFlag: Boolean(is_minor),
        tokenToUse: csrfToken,
      });
      errorsList = Array.isArray(data?.errors) ? data.errors : (data?.error ? [data.error] : []);
    }

    // Check for MediaWiki error responses
    if (errorsList.length > 0) {
      const firstErr = errorsList[0];
      const errorCode = firstErr.code || "unknown";
      const errorInfo = firstErr.text || firstErr.info || firstErr.message || "Unknown API error";

      console.error(`[JUSTAPEDIA EDIT ERROR] code: ${errorCode}, info: ${errorInfo}, target: ${targetTitle}`);

      if (["badtoken", "notoken", "permissiondenied", "assertuserfailed", "mustbeloggedin"].includes(errorCode)) {
        sessionAuthCache.delete(sessionToken);
        return {
          success: false,
          title: targetTitle,
          message: `Authentication error (${errorCode}): Your Justapedia login session has expired or lacks edit rights. Please re-login.`,
          raw_response: data,
        };
      } else if (errorCode === "editconflict") {
        return {
          success: false,
          title: targetTitle,
          message: `Edit Conflict on Justapedia: ${errorInfo}. Please refresh and re-examine the latest page revision.`,
          raw_response: data,
        };
      } else if (errorCode === "confirmemail") {
        return {
          success: false,
          title: targetTitle,
          message: `Email confirmation required: Your Justapedia account (@${actualUsername}) must validate its email address before making edits. Please visit Special:Preferences to confirm your email.`,
          raw_response: data,
        };
      } else if (errorCode === "hookaborted") {
        let cleanTalkHint = "";
        if (!hasCleanTalkBypass) {
          cleanTalkHint = ` (Hint: Account @${actualUsername} lacks 'cleantalk-bypass'. You can grant 'cleantalk-bypass' or 'sysop' to @${actualUsername} at Special:UserRights, or sign in as @Sourav).`;
        }
        return {
          success: false,
          title: targetTitle,
          message: `Edit aborted by Justapedia extension hook (${errorInfo})${cleanTalkHint}`,
          raw_response: data,
        };
      } else {
        return {
          success: false,
          title: targetTitle,
          message: `Justapedia API Error (${errorCode}): ${errorInfo}`,
          raw_response: data,
        };
      }
    }

    const editResult = data?.edit;
    if (editResult?.result === "Success") {
      const newRevid = editResult.newrevid;
      const nochange = Boolean(editResult.nochange);
      const articleUrl = `https://justapedia.org/${encodeURIComponent(targetTitle.replace(/ /g, "_"))}`;
      const diffUrl = newRevid
        ? `https://justapedia.org/index.php?title=${encodeURIComponent(targetTitle.replace(/ /g, "_"))}&diff=prev&oldid=${newRevid}`
        : articleUrl;
      const contribUrl = `https://justapedia.org/Special:Contributions/${encodeURIComponent(actualUsername)}`;

      let successMessage = nochange
        ? "Page content was already up to date (no changes detected)."
        : `Successfully saved to Justapedia under account "${actualUsername}"!`;

      if (use_sandbox) {
        successMessage += ` (Safely saved to ${targetTitle})`;
      }

      return {
        success: true,
        title: targetTitle,
        revid: newRevid,
        url: articleUrl,
        diff_url: diffUrl,
        editor: actualUsername,
        is_sandbox: use_sandbox,
        message: successMessage,
        user_contributions_url: contribUrl,
        raw_response: data,
      };
    }

    return {
      success: false,
      title: targetTitle,
      message: `Unexpected response from Justapedia edit API: ${JSON.stringify(editResult || data)}`,
      raw_response: data,
    };
  } catch (err: any) {
    return {
      success: false,
      title: request.title,
      message: `Save exception: ${err.message || String(err)}`,
    };
  }
}
