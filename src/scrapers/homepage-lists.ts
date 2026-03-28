import type { Page } from "playwright";
import { PAGE_SETTLE_DELAY_MS, TARGET_URL } from "../shared/constants.ts";
import { SCRAPE_CONFIG } from "../config/scrape-config.ts";
import type { LatestNotificationsResult } from "../shared/types.ts";
import { getHomepageSectionTitles } from "../shared/section-config.ts";
import { normalizeText, toAbsoluteUrl } from "../shared/utils.ts";

type RawSection = {
  title: string;
  viewMoreUrl: string | null;
  count: number;
  items: Array<{ title: string; url: string }>;
};

type RawAnchor = {
  title: string;
  href: string | null;
};

export async function scrapeHomepageLists(page: Page): Promise<LatestNotificationsResult> {
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 30_000 });
  try {
    await page.waitForSelector("a", { timeout: 10_000, state: "attached" });
  } catch {
    // Some CI runs render the page more slowly or differently.
    // We still attempt extraction from the loaded body.
  }
  await page.waitForTimeout(PAGE_SETTLE_DELAY_MS);

  const homepageData = await page.evaluate(
    ({ allowedTitles, baseUrl }) => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
      const toAbsolute = (href: string | null) => {
        if (!href) {
          return null;
        }

        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return null;
        }
      };

      const sections: Record<string, RawSection> = {};
      const anchors: RawAnchor[] = Array.from(document.querySelectorAll("a")).map((anchor) => ({
        title: normalize(anchor.textContent || ""),
        href: anchor.getAttribute("href"),
      }));
      const navigationTitles = new Set([
        "home",
        "latest jobs",
        "result",
        "admit card",
        "answer key",
        "syllabus",
        "search",
        "contact us",
      ]);
      const isPromotionalTitle = (title: string) => {
        const lower = title.toLowerCase();
        return (
          lower.includes("sarkari result") ||
          lower.includes("channel") ||
          lower.includes("android app") ||
          lower.includes("apple ios app") ||
          lower.includes("follow instagram") ||
          lower.includes("instagram") ||
          lower.includes("facebook") ||
          lower.includes("youtube") ||
          lower.includes("telegram") ||
          lower.includes("whatsapp") ||
          lower.includes("twitter") ||
          lower.includes("x ") ||
          lower === "education" ||
          lower.includes("contact us") ||
          lower.includes("privacy policy")
        );
      };
      const isBannerTitle = (title: string) => {
        const lower = title.toLowerCase();
        return Boolean(
          lower &&
          !navigationTitles.has(lower) &&
          lower !== "results" &&
          !allowedTitles.includes(title) &&
          !isPromotionalTitle(title),
        );
      };

      const findNextNonEmptyIndex = (startIndex: number) => {
        for (let index = startIndex; index < anchors.length; index += 1) {
          const anchor = anchors[index];
          if (anchor?.title) {
            return index;
          }
        }

        return -1;
      };

      const firstViewMoreIndex = anchors.findIndex((anchor) => anchor.title.toLowerCase() === "view more");
      const bannerLinks = anchors
        .slice(0, firstViewMoreIndex >= 0 ? firstViewMoreIndex : 0)
        .filter((anchor) => isBannerTitle(anchor.title))
        .map((anchor) => {
          const url = toAbsolute(anchor.href);
          if (!url || url.endsWith("/#")) {
            return null;
          }

          return {
            title: anchor.title,
            url,
          };
        })
        .filter((item): item is { title: string; url: string } => Boolean(item));

      for (let index = 0; index < anchors.length; index += 1) {
        const current = anchors[index];
        if (!current) {
          continue;
        }

        if (!allowedTitles.includes(current.title) || sections[current.title]) {
          continue;
        }

        const viewMoreIndex = findNextNonEmptyIndex(index + 1);
        const viewMoreAnchor = viewMoreIndex >= 0 ? anchors[viewMoreIndex] : undefined;
        if (!viewMoreAnchor || viewMoreAnchor.title.toLowerCase() !== "view more") {
          continue;
        }

        const items: Array<{ title: string; url: string }> = [];

        for (let innerIndex = viewMoreIndex + 1; innerIndex < anchors.length; innerIndex += 1) {
          const next = anchors[innerIndex];
          if (!next) {
            continue;
          }

          if (allowedTitles.includes(next.title)) {
            break;
          }

          if (!next.title) {
            continue;
          }

          if (isPromotionalTitle(next.title)) {
            continue;
          }

          const itemUrl = toAbsolute(next.href);
          if (!itemUrl) {
            continue;
          }

          items.push({
            title: next.title,
            url: itemUrl,
          });
        }

        if (items.length === 0) {
          continue;
        }

        sections[current.title] = {
          title: current.title,
          viewMoreUrl: toAbsolute(viewMoreAnchor.href),
          count: items.length,
          items,
        };
      }

      return {
        bannerLinks,
        latestSections: sections,
      };
    },
    { allowedTitles: getHomepageSectionTitles(), baseUrl: TARGET_URL },
  );

  const normalizedSections: LatestNotificationsResult["latestSections"] = Object.fromEntries(
    Object.entries(homepageData.latestSections).map(([sectionName, section]) => [
      normalizeText(sectionName),
      {
        title: normalizeText(section.title),
        viewMoreUrl: toAbsoluteUrl(section.viewMoreUrl),
        count: section.items.length,
        items: section.items.map((item) => ({
          title: normalizeText(item.title),
          url: item.url,
        })),
      },
    ]),
  );

  return {
    scrapedAt: new Date().toISOString(),
    source: TARGET_URL,
    sectionCount: Object.keys(normalizedSections).length,
    bannerLinks: SCRAPE_CONFIG.homepage.includeBannerLinks
      ? homepageData.bannerLinks.map((item) => ({
          title: normalizeText(item.title),
          url: item.url,
        }))
      : [],
    latestSections: normalizedSections,
  };
}
