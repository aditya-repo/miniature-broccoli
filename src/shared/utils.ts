import * as path from "node:path";
import { TARGET_URL } from "./constants.ts";

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function toAbsoluteUrl(href: string | null, baseUrl = TARGET_URL): string | null {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

export function resolveFromCwd(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}

export function formatDuration(durationMs: number): string {
  return `${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`;
}
