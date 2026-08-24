import { chromium } from "playwright";

const url = "https://www.notopedia.com/college-details/9/NLU-Delhi-National-Law-University,-Delhi";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  const overviewTable = document.querySelector("table.newclgcss");
  const overview = overviewTable
    ? Array.from(overviewTable.rows).map((row) => {
        const cells = Array.from(row.cells).map((cell) => norm(cell.textContent || ""));
        return { cells, html: row.innerHTML.slice(0, 300) };
      })
    : [];

  const courseLinks = Array.from(document.querySelectorAll(".courses_offered a, .course_list a, .courses_list a, .clg_course a, a[onclick*='discipline'], a[onclick*='course']"))
    .map((a) => ({
      text: norm(a.textContent || ""),
      onclick: a.getAttribute("onclick") || "",
      href: (a as HTMLAnchorElement).href || "",
      class: (a.className || "").toString().slice(0, 60),
    }))
    .filter((a) => a.text)
    .slice(0, 20);

  const coursesOfferedSection = document.querySelector(".courses_offered, .courses_list, .course_list");
  const coursesOfferedHtml = coursesOfferedSection?.innerHTML.slice(0, 2000) || "";

  const courseBlocks = Array.from(document.querySelectorAll(".course_detailss.varun, .course_detailss"))
    .filter((el, index, arr) => arr.indexOf(el) === index)
    .map((block) => ({
      title: norm(block.querySelector(".cdtitle")?.textContent || ""),
      tables: Array.from(block.querySelectorAll("table")).map((table) =>
        Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => norm(cell.textContent || ""))),
      ),
      eligibility: norm(block.querySelector(".eligibility_criteria, .eligibility")?.textContent || ""),
      text: norm(block.textContent || "").slice(0, 500),
    }))
    .slice(0, 5);

  const rankingRows = Array.from(document.querySelectorAll(".ranking_top tr, .rank_section2 tr"))
    .map((row) => Array.from(row.cells).map((cell) => norm(cell.textContent || "")))
    .filter((cells) => cells.some(Boolean));

  const brochureRows = Array.from(document.querySelectorAll(".collage--brochure table tr"))
    .map((row) => Array.from(row.cells).map((cell) => norm(cell.textContent || "")))
    .filter((cells) => cells.some(Boolean));

  const facultyRows = Array.from(document.querySelectorAll(".faculty_details table tr, .faculty_section table tr"))
    .map((row) => norm(row.textContent || ""))
    .filter(Boolean)
    .slice(0, 8);

  const address = norm(document.querySelector(".college_address, .clg_address, .address")?.textContent || "");
  const phone = norm(document.querySelector(".college_phone, .clg_phone, .phone")?.textContent || "");
  const website = (document.querySelector("a[href*='http']:not([href*='notopedia'])") as HTMLAnchorElement | null)?.href || "";

  const banner = {
    name: norm(document.querySelector("h1, .college_name, .clg_name")?.textContent || document.title),
    location: norm(document.querySelector(".bannerdetails, .college_location")?.textContent || "").slice(0, 200),
    applyUrl: Array.from(document.querySelectorAll("a[href]"))
      .find((anchor) => /apply now/i.test(norm(anchor.textContent || "")))
      ?.href || null,
  };

  return {
    banner,
    overview: overview.slice(0, 15),
    courseLinks,
    coursesOfferedHtml: coursesOfferedHtml.slice(0, 1500),
    courseBlocks,
    rankingRows: rankingRows.slice(0, 8),
    brochureRows: brochureRows.slice(0, 8),
    facultyRows,
    address,
    phone,
    website,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
