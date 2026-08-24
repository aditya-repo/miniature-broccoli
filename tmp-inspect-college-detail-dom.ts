import { chromium } from "playwright";

const url = "https://www.notopedia.com/college-details/10/Jadavpur-University";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  const overviewRows = Array.from(document.querySelectorAll(".clgdtlbox table tr, .clgdtl_col table tr, .overview table tr, .clgdtl table tr"))
    .map((row) => Array.from(row.cells).map((cell) => norm(cell.textContent || "")))
    .filter((cells) => cells.length >= 2);

  const courseTabs = Array.from(document.querySelectorAll(".course_tab, .courses_tab, .nav-tabs a, .course_list a, .clg_course_tab a, #course_tab a, .cd_tab a"))
    .map((el) => norm(el.textContent || ""))
    .filter(Boolean);

  const courseBlocks = Array.from(document.querySelectorAll(".course_detailss, .course-details, .cd_col"))
    .map((el) => ({
      class: (el.className || "").toString().slice(0, 60),
      title: norm(el.querySelector("h2, h3, .cdtitle")?.textContent || ""),
      text: norm(el.textContent || "").slice(0, 300),
    }))
    .slice(0, 10);

  const selectors = [
    ".clgdtlbox",
    ".clgdtl_col",
    ".clgdtl_cols",
    ".clgdtlrow",
    ".clgdtl",
    ".clgdtlbox table",
    "#course_tab",
    ".course_tab",
    ".courses_offered",
    ".faculty_details",
    ".college_ranking",
    ".college_brochure",
    ".placement_stats",
    ".contact_details",
  ].map((selector) => ({ selector, count: document.querySelectorAll(selector).length }));

  const allClasses = [...new Set(
    Array.from(document.querySelectorAll("[class]"))
      .map((el) => (el.className || "").toString())
      .filter((c) => /clg|course|detail|faculty|rank|brochure|placement|contact/i.test(c))
      .slice(0, 80),
  )];

  const h2s = Array.from(document.querySelectorAll("h2.cdtitle, h2.subtitle, .section-title")).map((el) => norm(el.textContent || ""));

  return { overviewRows: overviewRows.slice(0, 20), courseTabs: courseTabs.slice(0, 20), courseBlocks, selectors, allClasses: allClasses.slice(0, 40), h2s };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
