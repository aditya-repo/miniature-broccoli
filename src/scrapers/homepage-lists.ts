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

/** Site may use singular/plural or different casing for the same section. */
const SECTION_TITLE_ALIASES: Record<string, string> = {
  "latest job": "Latest Jobs",
  "latest jobs": "Latest Jobs",
  "admit card": "Admit Card",
  result: "Result",
  results: "Result",
  "answer key": "Answer Key",
  syllabus: "Syllabus",
  admission: "Admission",
};

function canonicalizeSectionTitle(title: string, allowedTitles: string[]): string | null {
  const normalized = normalizeText(title);
  if (allowedTitles.includes(normalized)) {
    return normalized;
  }

  const aliased = SECTION_TITLE_ALIASES[normalized.toLowerCase()];
  if (aliased && allowedTitles.includes(aliased)) {
    return aliased;
  }

  return null;
}

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
    ({ allowedTitles, sectionAliases, baseUrl }) => {
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

      const resolveSectionTitle = (title: string): string | null => {
        const normalized = normalize(title);
        if (allowedTitles.includes(normalized)) {
          return normalized;
        }

        const aliased = sectionAliases[normalized.toLowerCase()];
        if (aliased && allowedTitles.includes(aliased)) {
          return aliased;
        }

        return null;
      };

      const sections: Record<string, RawSection> = {};
      const anchors: RawAnchor[] = Array.from(document.querySelectorAll("a")).map((anchor) => ({
        title: normalize(anchor.textContent || ""),
        href: anchor.getAttribute("href"),
      }));
      const navigationTitles = new Set([
        "home",
        "latest job",
        "latest jobs",
        "result",
        "results",
        "admit card",
        "answer key",
        "syllabus",
        "admission",
        "up scholarship",
        "search",
        "contact us",
        "about us",
        "more",
        "discover more",
      ]);
      const isPromotionalTitle = (title: string) => {
        const lower = title.toLowerCase();
        // The site brands itself with a lowercase L ("SARKARl RESULT") and
        // without spacing ("SarkariResults"), so compare on letters only.
        const lettersOnly = lower.replace(/[^a-z]/g, "").replace(/l/g, "i");
        return (
          lettersOnly.includes("sarkariresu") ||
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
      const staticPageTitles = new Set([
        "skip to content",
        "terms and conditions",
        "disclaimer",
        "sitemap",
      ]);
      const isBannerTitle = (title: string) => {
        const lower = title.toLowerCase();
        return Boolean(
          lower &&
          // Anchors wrapping the logo expose raw markup as their text.
          !title.startsWith("<") &&
          !navigationTitles.has(lower) &&
          !staticPageTitles.has(lower) &&
          !resolveSectionTitle(title) &&
          !isPromotionalTitle(title),
        );
      };

      // Current site layout: Section title → items → "View More" → next section.
      // Older layout had "View More" immediately after the title; support both.
      const isContentSectionStart = (index: number) => {
        const anchor = anchors[index];
        if (!anchor || !resolveSectionTitle(anchor.title)) {
          return false;
        }

        const next = anchors[index + 1];
        if (!next?.title) {
          return false;
        }

        // Nav cluster: section-named links sit next to each other.
        if (resolveSectionTitle(next.title)) {
          return false;
        }

        // Legacy layout: title immediately followed by View More.
        if (next.title.toLowerCase() === "view more") {
          return true;
        }

        // Current layout: title → items → View More → next section.
        // Require a View More before the next section title so header nav
        // (e.g. Admission → UP Scholarship → Syllabus) is not treated as content.
        for (let lookAhead = index + 1; lookAhead < anchors.length; lookAhead += 1) {
          const candidate = anchors[lookAhead];
          if (!candidate?.title) {
            continue;
          }

          if (candidate.title.toLowerCase() === "view more") {
            return true;
          }

          if (resolveSectionTitle(candidate.title)) {
            return false;
          }
        }

        return false;
      };

      const firstContentSectionIndex = anchors.findIndex((_, index) => isContentSectionStart(index));
      const bannerLinks = anchors
        .slice(0, firstContentSectionIndex >= 0 ? firstContentSectionIndex : 0)
        .filter((anchor) => isBannerTitle(anchor.title))
        .map((anchor) => {
          const url = toAbsolute(anchor.href);
          // Root and in-page anchors are navigation, not notifications.
          if (!url || url.endsWith("/#") || url.includes("#") || url === baseUrl) {
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

        const sectionTitle = resolveSectionTitle(current.title);
        if (!sectionTitle || sections[sectionTitle] || !isContentSectionStart(index)) {
          continue;
        }

        const next = anchors[index + 1];
        if (!next?.title) {
          continue;
        }

        const items: Array<{ title: string; url: string }> = [];
        let viewMoreUrl: string | null = null;
        let startIndex = index + 1;

        // Legacy layout: title, then immediately "View More", then items.
        if (next.title.toLowerCase() === "view more") {
          viewMoreUrl = toAbsolute(next.href);
          startIndex = index + 2;
        }

        for (let innerIndex = startIndex; innerIndex < anchors.length; innerIndex += 1) {
          const itemAnchor = anchors[innerIndex];
          if (!itemAnchor?.title) {
            continue;
          }

          if (itemAnchor.title.toLowerCase() === "view more") {
            viewMoreUrl = toAbsolute(itemAnchor.href);
            // Current layout ends the section at View More.
            if (startIndex === index + 1) {
              break;
            }
            // Legacy layout: View More was already consumed; ignore trailing ones.
            continue;
          }

          if (resolveSectionTitle(itemAnchor.title)) {
            break;
          }

          if (isPromotionalTitle(itemAnchor.title)) {
            continue;
          }

          const itemUrl = toAbsolute(itemAnchor.href);
          if (!itemUrl) {
            continue;
          }

          items.push({
            title: itemAnchor.title,
            url: itemUrl,
          });
        }

        if (items.length === 0) {
          continue;
        }

        sections[sectionTitle] = {
          title: sectionTitle,
          viewMoreUrl,
          count: items.length,
          items,
        };
      }

      return {
        bannerLinks,
        latestSections: sections,
      };
    },
    {
      allowedTitles: getHomepageSectionTitles(),
      sectionAliases: SECTION_TITLE_ALIASES,
      baseUrl: TARGET_URL,
    },
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

  // Ensure alias titles still map to configured canonical names.
  for (const [rawName, section] of Object.entries(normalizedSections)) {
    const canonical = canonicalizeSectionTitle(rawName, getHomepageSectionTitles());
    if (canonical && canonical !== rawName && !normalizedSections[canonical]) {
      normalizedSections[canonical] = { ...section, title: canonical };
      delete normalizedSections[rawName];
    }
  }

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
