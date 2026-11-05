import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return url;
  }
}

export function formatTimestamp(ts?: string): string {
  if (!ts) return "N/A";
  if (ts.length === 14) {
    // Wayback Machine YYYYMMDDhhmmss format
    const y = ts.substring(0, 4);
    const m = ts.substring(4, 6);
    const d = ts.substring(6, 8);
    const h = ts.substring(8, 10);
    const min = ts.substring(10, 12);
    return `${y}-${m}-${d} ${h}:${min} UTC`;
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
