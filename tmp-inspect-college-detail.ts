import { chromium } from "playwright";

const url = "https://www.notopedia.com/college-details/9/NLU-Delhi-National-Law-University,-Delhi";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const apiCalls: Array<{ url: string; body: string }> = [];

page.on("response", async (response) => {
  const responseUrl = response.url();
  if (/ajax|api|college|course|detail/i.test(responseUrl) && response.request().resourceType() !== "image") {
    let body = "";
    try {
      body = (await response.text()).slice(0, 1200);
    } catch {
      // ignore
    }
    apiCalls.push({ url: responseUrl, body });
  }
});

await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,strong,b,.nav-tabs li, .tab-pane")).map((el) => ({
    tag: el.tagName,
    class: (el.className || "").toString().slice(0, 60),
    text: norm(el.textContent || "").slice(0, 100),
  })).filter((h) => h.text).slice(0, 60);

  const tables = Array.from(document.querySelectorAll("table")).map((table, i) => ({
    i,
    rows: Array.from(table.rows).slice(0, 5).map((row) => Array.from(row.cells).map((cell) => norm(cell.textContent || "").slice(0, 80))),
  })).slice(0, 8);

  const keyBlocks = Array.from(document.querySelectorAll(".clgdtl, .college-detail, .detail-box, .overview, .clg-info, .clgdtlrow, .clgdtlbox, .clgdtl_col, .clgdtl_cols, .clgdtlrow, .clgdtlbox, .clgdtl_col, .clgdtl_cols, .clgdtlrow, .clgdtlbox, .clgdtl_col, .clgdtl_cols")).map((el) => ({
    class: (el.className || "").toString().slice(0, 80),
    text: norm(el.textContent || "").slice(0, 200),
  })).slice(0, 20);

  const bodySample = norm(document.body.innerText).slice(0, 3000);
  return { title: document.title, headings, tables, keyBlocks, bodySample };
});

console.log("API", JSON.stringify(apiCalls.slice(0, 15), null, 2));
console.log("PAGE", JSON.stringify(info, null, 2));
await browser.close();
