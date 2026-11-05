import { spawn } from "child_process";
import path from "path";

export interface BridgeRequest {
  url?: string;
  method?: "GET" | "POST";
  data?: Record<string, any>;
  params?: Record<string, any>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface BridgeResponse<T = any> {
  status: number;
  data?: T;
  text?: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  error?: string;
}

const BRIDGE_URL = "http://127.0.0.1:5005";
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "justapedia_bridge.py");

/**
 * Execute Justapedia API request bypassing Cloudflare WAF via curl_cffi Chrome impersonation.
 * Tries local fast microservice (127.0.0.1:5005) first, with transparent fallback to CLI spawn.
 */
export async function executeBridgeRequest<T = any>(
  req: BridgeRequest
): Promise<BridgeResponse<T>> {
  // 1. Try local daemon service for speed (~50-400ms)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const daemonResp = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (daemonResp.ok) {
      const json: BridgeResponse<T> = await daemonResp.json();
      return json;
    }
  } catch {
    // Daemon not running or timed out; proceed to fallback
  }

  // 2. Direct Python subprocess fallback
  return new Promise((resolve) => {
    const py = spawn("python", [SCRIPT_PATH]);
    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d));
    py.stderr.on("data", (d) => (stderr += d));

    py.on("close", (code) => {
      if (code !== 0) {
        resolve({
          status: 500,
          cookies: {},
          headers: {},
          error: `Bridge process exited with code ${code}: ${stderr}`,
        });
        return;
      }

      try {
        const parsed: BridgeResponse<T> = JSON.parse(stdout);
        resolve(parsed);
      } catch (err: any) {
        resolve({
          status: 500,
          cookies: {},
          headers: {},
          error: `Failed to parse bridge output: ${err.message}`,
        });
      }
    });

    py.stdin.write(JSON.stringify(req));
    py.stdin.end();
  });
}
