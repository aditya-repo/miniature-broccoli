import type { LatestNotificationsResult } from "./types.ts";

let latestNotificationsCache: LatestNotificationsResult | null = null;

export function setLatestNotificationsCache(data: LatestNotificationsResult): void {
  latestNotificationsCache = data;
}

export function getLatestNotificationsCache(): LatestNotificationsResult | null {
  return latestNotificationsCache;
}
