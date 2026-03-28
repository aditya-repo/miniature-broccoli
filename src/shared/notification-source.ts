import { BANNER_LINKS_SECTION } from "./constants.ts";
import { SCRAPE_CONFIG, type DetailSectionKey } from "../config/scrape-config.ts";
import type { LatestNotificationsResult, NotificationItem } from "./types.ts";
import { readJsonFile } from "./files.ts";
import { getLatestNotificationsCache } from "./runtime-cache.ts";

type LoadSectionItemsOptions = {
  manualUrl?: string;
  manualTitle: string;
  sectionName: string;
};

export async function loadSectionItems(options: LoadSectionItemsOptions): Promise<NotificationItem[]> {
  const manualUrl = options.manualUrl?.trim() || "";
  if (manualUrl) {
    return [
      {
        title: options.manualTitle,
        url: manualUrl,
      },
    ];
  }

  const parsed = await loadLatestNotificationsSource();
  const section = parsed.latestSections[options.sectionName];

  if (!section || !Array.isArray(section.items) || section.items.length === 0) {
    throw new Error(
      `No '${options.sectionName}' items found in ${SCRAPE_CONFIG.homepage.outputFile}. Run 'npm run scrape' first.`,
    );
  }

  return section.items;
}

export async function loadBannerLinks(): Promise<NotificationItem[]> {
  const bannerConfig = SCRAPE_CONFIG.sections.banner;
  if (bannerConfig.manualUrl.trim()) {
    return [
      {
        title: "Manual Banner URL",
        url: bannerConfig.manualUrl.trim(),
      },
    ];
  }

  const parsed = await loadLatestNotificationsSource();
  if (!Array.isArray(parsed.bannerLinks) || parsed.bannerLinks.length === 0) {
    throw new Error(
      `No '${BANNER_LINKS_SECTION}' found in ${SCRAPE_CONFIG.homepage.outputFile}. Run 'npm run scrape' first.`,
    );
  }

  return parsed.bannerLinks;
}

async function loadLatestNotificationsSource(): Promise<LatestNotificationsResult> {
  const cached = getLatestNotificationsCache();
  if (cached) {
    return cached;
  }

  return readJsonFile<LatestNotificationsResult>(SCRAPE_CONFIG.homepage.outputFile);
}

export async function loadLatestJobs(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("latestJobs");
}

export async function loadAdmitCards(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("admitCard");
}

export async function loadResults(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("result");
}

export async function loadAnswerKeys(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("answerKey");
}

export async function loadSyllabusItems(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("syllabus");
}

export async function loadAdmissions(): Promise<NotificationItem[]> {
  return loadSectionItemsByKey("admission");
}

export async function loadSectionItemsByKey(sectionKey: DetailSectionKey): Promise<NotificationItem[]> {
  if (sectionKey === "banner") {
    return loadBannerLinks();
  }

  const sectionConfig = SCRAPE_CONFIG.sections[sectionKey];
  return loadSectionItems({
    manualUrl: sectionConfig.manualUrl,
    manualTitle: `Manual ${sectionConfig.displayName} URL`,
    sectionName: sectionConfig.sectionName,
  });
}
