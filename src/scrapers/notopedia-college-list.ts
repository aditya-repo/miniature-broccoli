import type { Page } from "playwright";
import { createConfiguredPage, launchBrowser } from "../shared/browser.ts";

export type NotopediaCollegeRanking = {
  source: string;
  rank: string;
};

export type NotopediaCollegeListItem = {
  id: string;
  name: string;
  slug: string;
  url: string;
  logoUrl: string | null;
  photoUrl: string | null;
  coursesCount: string | null;
  minFees: string | null;
  managementType: string | null;
  establishedYear: string | null;
  applyUrl: string | null;
  rankings: NotopediaCollegeRanking[];
};

export type NotopediaCollegeListResult = {
  scrapedAt: string;
  source: string;
  pageCount: number;
  count: number;
  colleges: NotopediaCollegeListItem[];
};

export const NOTOPEDIA_COLLEGE_LIST_URL = "https://www.notopedia.com/college-list";
export const NOTOPEDIA_COLLEGE_LIST_API =
  "https://www.notopedia.com/includes/ajax/index.php?p=ajax-college-listing";

const DEFAULT_PAGE_SIZE = 9;
const LISTING_RESPONSE_TIMEOUT_MS = 30_000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string): string {
  return normalizeText(decodeHtml(value.replace(/<[^>]+>/g, " ")));
}

function firstMatch(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match?.[1] ? normalizeText(match[1]) : null;
}

function buildListingFormData(page: number): FormData {
  const form = new FormData();
  form.append("c_page", String(page));
  form.append("aits_order_direction", "asc");
  form.append("search_action", "yes");

  for (const key of [
    "est_year",
    "courses",
    "rank_type_ids",
    "state_ids",
    "stream_ids",
    "search_txt_course",
    "city_ids",
    "course_type_ids",
    "search_txt_course_mobile",
    "course_id",
    "management_type_ids",
  ]) {
    form.append(key, "");
  }

  return form;
}

export function parseCollegeListHtml(html: string): NotopediaCollegeListItem[] {
  const cards = html.split('<div class="col-md-4 cr_cols').slice(1);
  const colleges: NotopediaCollegeListItem[] = [];

  for (const rawCard of cards) {
    const card = `<div class="col-md-4 cr_cols${rawCard}`;
    const detailMatch = card.match(
      /href="https:\/\/www\.notopedia\.com\/college-details\/(\d+)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );

    if (!detailMatch) {
      continue;
    }

    const id = detailMatch[1] ?? "";
    const slug = decodeHtml(detailMatch[2] ?? "");
    const name = stripTags(detailMatch[3] ?? "");
    if (!id || !name) {
      continue;
    }

    const logoUrl = firstMatch(card, /<span class="crsymbole">[\s\S]*?<img[^>]+src="([^"]+)"/i);
    const photoUrl = firstMatch(card, /<div class="collegeimg"[\s\S]*?<img[^>]+src="([^"]+)"/i);
    const coursesCount = firstMatch(card, /<p>\s*Courses\s*<\/p>\s*<h1>\s*([^<]+)\s*<\/h1>/i);
    const minFees = firstMatch(card, /<p>\s*Min fees\s*<\/p>\s*<h1>\s*([^<]+)\s*<\/h1>/i);
    const establishedYear = firstMatch(card, /ESTD year\s*<\/span>\s*-\s*(\d{4})/i);

    const managementBlock = card.match(/<div class="managementpublic"[\s\S]*?<\/div>\s*<div class="detailapply_row">/i)?.[0] ?? "";
    const managementType =
      firstMatch(managementBlock, /<div class="col-md-6 mpub"[^>]*>\s*<p>([^<]+)<\/p>/i) ||
      firstMatch(managementBlock, /<p>\s*<!--[\s\S]*?-->\s*([^<]+)<\/p>/i);

    const applyUrl = firstMatch(card, /<a href="(https?:\/\/[^"]+)"[^>]*>\s*Apply Now/i);

    const rankings: NotopediaCollegeRanking[] = [];
    const rankingItems = card.match(/<li><div class="cl-rt">[\s\S]*?<\/li>/gi) ?? [];
    for (const rankingItem of rankingItems) {
      const source = firstMatch(rankingItem, /(?:title|alt)="([^"]+)"/i);
      const rank = firstMatch(rankingItem, /<span>\s*([^<]+)\s*<\/span>/i);
      if (source && rank) {
        rankings.push({ source, rank });
      }
    }

    colleges.push({
      id,
      name,
      slug,
      url: `https://www.notopedia.com/college-details/${id}/${slug}`,
      logoUrl,
      photoUrl,
      coursesCount,
      minFees,
      managementType,
      establishedYear,
      applyUrl,
      rankings,
    });
  }

  return colleges;
}

export async function fetchCollegeListPage(page: number): Promise<string> {
  const response = await fetch(`${NOTOPEDIA_COLLEGE_LIST_API}&unid=${Date.now()}-${page}`, {
    method: "POST",
    body: buildListingFormData(page),
    headers: {
      Referer: NOTOPEDIA_COLLEGE_LIST_URL,
    },
  });

  if (!response.ok) {
    throw new Error(`College list page ${page} failed with HTTP ${response.status}`);
  }

  return response.text();
}

export async function discoverCollegeListPageCount(): Promise<number> {
  const html = await fetchCollegeListPage(1);
  const optionValues = [...html.matchAll(/<option value="(\d+)"\s*>/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (optionValues.length === 0) {
    return 1;
  }

  return Math.max(...optionValues);
}

type ScrapeCollegeListOptions = {
  pageLimit?: number;
  startPage?: number;
  onProgress?: (info: { page: number; totalPages: number; colleges: number }) => void;
};

function isListingResponse(url: string): boolean {
  return url.includes("ajax-college-listing");
}

async function readListingPageCount(page: Page): Promise<number> {
  const values = await page.locator("select.gtpval option").evaluateAll((options) =>
    options
      .map((option) => Number((option as HTMLOptionElement).value))
      .filter((value) => Number.isFinite(value) && value > 0),
  );

  if (values.length === 0) {
    return 1;
  }

  return Math.max(...values);
}

async function loadListingPage(page: Page, pageNumber: number): Promise<string> {
  const responsePromise = page.waitForResponse(
    (response) => isListingResponse(response.url()) && response.status() === 200,
    { timeout: LISTING_RESPONSE_TIMEOUT_MS },
  );

  await page.evaluate((targetPage) => {
    const paginate = (window as Window & { paginForList?: (page: number) => void }).paginForList;
    if (typeof paginate !== "function") {
      throw new Error("paginForList is not available on the college list page.");
    }

    paginate(targetPage);
  }, pageNumber);

  const response = await responsePromise;
  return response.text();
}

export async function scrapeNotopediaCollegeList(
  options: ScrapeCollegeListOptions = {},
): Promise<NotopediaCollegeListResult> {
  const browser = await launchBrowser();

  try {
    const page = await createConfiguredPage(browser);
    await page.goto(NOTOPEDIA_COLLEGE_LIST_URL, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForSelector("#order-list-holder .cr_cols", { timeout: LISTING_RESPONSE_TIMEOUT_MS });

    const discoveredPages = await readListingPageCount(page);
    const startPage = Math.max(1, options.startPage ?? 1);
    const requestedLimit = options.pageLimit ?? discoveredPages;
    const lastPage = Math.min(discoveredPages, startPage + Math.max(requestedLimit, 1) - 1);
    const byId = new Map<string, NotopediaCollegeListItem>();

    for (let currentPage = startPage; currentPage <= lastPage; currentPage += 1) {
      const html =
        currentPage === 1 && startPage === 1
          ? await page.locator("#order-list-holder").innerHTML()
          : await loadListingPage(page, currentPage);
      for (const college of parseCollegeListHtml(html)) {
        byId.set(college.id, college);
      }

      options.onProgress?.({
        page: currentPage,
        totalPages: lastPage,
        colleges: byId.size,
      });
    }

    const colleges = [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));

    return {
      scrapedAt: new Date().toISOString(),
      source: NOTOPEDIA_COLLEGE_LIST_URL,
      pageCount: lastPage - startPage + 1,
      count: colleges.length,
      colleges,
    };
  } finally {
    await browser.close();
  }
}

export function estimateCollegeCount(pageCount: number): number {
  return pageCount * DEFAULT_PAGE_SIZE;
}
