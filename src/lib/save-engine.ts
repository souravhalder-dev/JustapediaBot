import { SaveArticleRequest, SaveArticleResponse } from "./types";
import { formatCookieHeader, verifyUserSession } from "./auth";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (JustapediaSaveEngine/2.0)";

/**
 * Consistent Saving Mechanism matching the Birth Update Bot (justapedia_client.py)
 * 
 * Guarantees that:
 * 1. Only authenticated user sessions are accepted.
 * 2. MediaWiki explicitly verifies the user's identity before any edit.
 * 3. The CSRF token is retrieved under that specific user's session cookies.
 * 4. The edit is committed using the user's authenticated cookies so it is
 *    properly recorded in their user contribution history on Justapedia.
 * 5. No fallback bot account is used when a user is logged in.
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
    is_minor = true,
    is_bot = true,
    use_sandbox = false,
  } = request;

  let targetTitle = title.trim();
  let textToSave = wikitext;
  let finalSummary = summary.trim();

  if (use_sandbox) {
    targetTitle = "Justapedia:Sandbox";
    textToSave = `<!-- TEST DRAFT FOR [${title}] VIA JUSTAPEDIA ARCHIVEBOT -->\n{{Please leave this line alone (sandbox heading)}}\n\n${wikitext}`;
    finalSummary = `[TEST] Draft for ${title}: ${summary}`;
  }

  // 1. Verify user session token
  if (!sessionToken) {
    return {
      success: false,
      title: targetTitle,
      message: "Authentication required: You must be logged in with your Justapedia account to save edits.",
    };
  }

  const verification = await verifyUserSession(sessionToken);
  if (!verification.valid || !verification.session || !verification.user) {
    return {
      success: false,
      title: targetTitle,
      message: verification.error || "Authentication failed: Session invalid or expired. Please re-authenticate.",
    };
  }

  const { cookies } = verification.session;
  const cookieHeader = formatCookieHeader(cookies);
  const expectedUsername = verification.user.username;

  try {
    // 2. Strictly verify the current authenticated identity with Justapedia Action API
    const userinfoUrl = `${JUSTAPEDIA_API}?action=query&meta=userinfo&format=json`;
    const userinfoResp = await fetch(userinfoUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Cookie": cookieHeader,
      },
      cache: "no-store",
    });

    if (!userinfoResp.ok) {
      return {
        success: false,
        title: targetTitle,
        message: `Justapedia API returned HTTP ${userinfoResp.status} during user verification.`,
      };
    }

    const userinfoData = await userinfoResp.json();
    const uinfo = userinfoData?.query?.userinfo;
    const actualUsername = uinfo?.name;
    const isAnon = !uinfo || Boolean(uinfo.anon);

    if (isAnon || !actualUsername) {
      return {
        success: false,
        title: targetTitle,
        message: "Authentication failed: Justapedia session cookies have expired. Please log in again.",
        raw_response: uinfo,
      };
    }

    if (expectedUsername && actualUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
      return {
        success: false,
        title: targetTitle,
        message: `Authentication mismatch: MediaWiki authenticated as '${actualUsername}' instead of '${expectedUsername}'. Please log in again.`,
        raw_response: uinfo,
      };
    }

    // 3. Retrieve authenticated user's CSRF token
    const tokenUrl = `${JUSTAPEDIA_API}?action=query&meta=tokens&type=csrf&format=json`;
    const tokenResp = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Cookie": cookieHeader,
      },
      cache: "no-store",
    });

    if (!tokenResp.ok) {
      return {
        success: false,
        title: targetTitle,
        message: "Failed to connect to Justapedia to obtain CSRF token.",
      };
    }

    const tokenData = await tokenResp.json();
    const csrfToken = tokenData?.query?.tokens?.csrftoken;

    if (!csrfToken || csrfToken === "+\\") {
      return {
        success: false,
        title: targetTitle,
        message: "Failed to retrieve valid CSRF token with session cookies. Please re-authenticate.",
        raw_response: tokenData,
      };
    }

    // 4. Submit edit under the logged-in user's account
    const formData = new URLSearchParams();
    formData.append("action", "edit");
    formData.append("title", targetTitle);
    formData.append("text", textToSave);
    formData.append("summary", finalSummary);
    formData.append("token", csrfToken);
    formData.append("format", "json");

    if (is_minor) formData.append("minor", "1");
    if (is_bot) formData.append("bot", "1");
    if (basetimestamp && !use_sandbox) {
      formData.append("basetimestamp", basetimestamp);
    }

    const editResp = await fetch(JUSTAPEDIA_API, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookieHeader,
      },
      body: formData.toString(),
      cache: "no-store",
    });

    if (!editResp.ok) {
      return {
        success: false,
        title: targetTitle,
        message: `Justapedia edit POST failed with HTTP ${editResp.status}.`,
      };
    }

    const data = await editResp.json();

    // 5. Check for MediaWiki error responses
    if (data.error) {
      const errorCode = data.error.code || "unknown";
      const errorInfo = data.error.info || "Unknown API error";

      if (["badtoken", "notoken", "permissiondenied", "assertuserfailed", "mustbeloggedin"].includes(errorCode)) {
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
      title: targetTitle,
      message: `Save exception: ${err.message || String(err)}`,
    };
  }
}
