import { chromium, type Browser, type Page } from "playwright";
import { DEFAULT_TIMEOUT_MS, USER_AGENT } from "./constants.ts";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export async function createConfiguredPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ userAgent: USER_AGENT });
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  return page;
}
