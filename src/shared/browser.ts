import { chromium, type Browser, type Page } from "playwright";
import { DEFAULT_TIMEOUT_MS, PAGE_SETTLE_DELAY_MS, USER_AGENT } from "./constants.ts";

export const IS_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

const CHROMIUM_ARGS = IS_CI
  ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  : [];

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
  });
}

export async function createConfiguredPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
  return page;
}

/** Navigate with retries — GitHub Actions runners are slower and less stable than local dev. */
export async function gotoPage(page: Page, url: string): Promise<void> {
  const maxAttempts = IS_CI ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.warn(`[browser] Navigation retry ${attempt}/${maxAttempts} for ${url}`);
      await page.waitForTimeout(PAGE_SETTLE_DELAY_MS * attempt);
    }
  }
}
