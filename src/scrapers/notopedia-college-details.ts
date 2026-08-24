import type { Page } from "playwright";
import { PAGE_SETTLE_DELAY_MS } from "../shared/constants.ts";
import { createConfiguredPage, launchBrowser } from "../shared/browser.ts";
import type { NotopediaCollegeListItem } from "./notopedia-college-list.ts";

export type NotopediaCollegeOverview = Record<string, string | string[]>;

export type NotopediaCollegePlacement = {
  majorRecruiters: string | null;
  batchStrength: string | null;
  studentsRegisteredPerYear: string | null;
  internshipPartners: Array<{ category: string; names: string }>;
};

export type NotopediaCollegeRankingDetail = {
  rank: string | null;
  category: string;
  stream: string;
  yearDetails: string;
};

export type NotopediaCollegeBrochure = {
  type: string;
  stream: string;
  title: string;
  downloadUrl: string | null;
};

export type NotopediaCollegeFaculty = {
  name: string;
  designation: string | null;
  email: string | null;
};

export type NotopediaCollegeCourseDetail = {
  duration: string | null;
  type: string | null;
  seats: string | null;
  fees: string | null;
  disciplines: string[];
  eligibility: {
    requiredQualification: string | null;
    requiredEntranceExam: string | null;
    other: string[];
  };
};

export type NotopediaCollegeDetail = {
  listId: string;
  listName: string;
  listUrl: string;
  extractedAt: string;
  name: string;
  location: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  applyUrl: string | null;
  overview: NotopediaCollegeOverview;
  placement: NotopediaCollegePlacement | null;
  rankings: NotopediaCollegeRankingDetail[];
  brochures: NotopediaCollegeBrochure[];
  faculty: NotopediaCollegeFaculty[];
  courses: NotopediaCollegeCourseDetail[];
};

export type NotopediaCollegeDetailsBatchResult = {
  scrapedAt: string;
  sourceListFile: string;
  batchNumber: number;
  batchSize: number;
  startIndex: number;
  endIndex: number;
  processedCount: number;
  details: NotopediaCollegeDetail[];
};

type RawCollegeDetail = Omit<NotopediaCollegeDetail, "listId" | "listName" | "listUrl" | "extractedAt">;

export async function scrapeNotopediaCollegeDetail(
  page: Page,
  listItem: NotopediaCollegeListItem,
): Promise<NotopediaCollegeDetail> {
  await page.goto(listItem.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table.newclgcss", { timeout: 30_000 });
  await page.waitForTimeout(PAGE_SETTLE_DELAY_MS);

  const extracted = await page.evaluate((): RawCollegeDetail => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

    const findSectionByHeading = (headingText: string) => {
      const heading = Array.from(document.querySelectorAll("h2.cdtitle, h2.subtitle")).find((element) =>
        normalize(element.textContent || "").toLowerCase() === headingText.toLowerCase(),
      );

      return heading?.closest(".pad-40, .col-md-12, section") ?? heading?.parentElement ?? null;
    };

    const parseTableRows = (table: HTMLTableElement | null) =>
      table
        ? Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => normalize(cell.textContent || "")))
        : [];

    const overview: Record<string, string | string[]> = {};
    const overviewTable = document.querySelector("table.newclgcss");
    if (overviewTable) {
      for (const row of Array.from(overviewTable.rows)) {
        const label = normalize(row.cells[0]?.textContent || "");
        const valueCell = row.cells[1];
        if (!label || !valueCell) {
          continue;
        }

        const labelKey = label.toLowerCase();
        if (labelKey === "courses offered") {
          overview[label] = Array.from(valueCell.querySelectorAll("a.tags, a"))
            .map((anchor) => normalize(anchor.textContent || ""))
            .filter(Boolean);
          continue;
        }

        if (labelKey === "facilities") {
          overview[label] = Array.from(valueCell.querySelectorAll("li, span, img"))
            .map((element) => normalize(element.getAttribute("title") || element.textContent || ""))
            .filter(Boolean);
          continue;
        }

        overview[label] = normalize(valueCell.textContent || "");
      }
    }

    const placementSection = Array.from(overviewTable?.rows ?? []).find((row) =>
      normalize(row.cells[0]?.textContent || "").toLowerCase() === "placement",
    );
    const placementCell = placementSection?.cells[1] ?? null;
    const placementTable = placementCell?.querySelector("table") ?? null;
    const placementRows = parseTableRows(placementTable);
    const placementMap = new Map<string, string>();
    for (const [label, value] of placementRows) {
      if (label) {
        placementMap.set(label.toLowerCase(), value || "");
      }
    }

    const internshipPartners: Array<{ category: string; names: string }> = [];
    for (const row of placementRows) {
      if (row.length >= 2 && row[0] && /law firm|corporate|judges/i.test(row[0])) {
        internshipPartners.push({ category: row[0], names: row[1] || "" });
      }
    }

    const placement = placementCell
      ? {
          majorRecruiters: placementMap.get("major recruiters") || null,
          batchStrength: placementMap.get("batch strength") || null,
          studentsRegisteredPerYear: placementMap.get("no. of students registered every year") || null,
          internshipPartners,
        }
      : null;

    const rankingSection = findSectionByHeading("College Ranking");
    const rankingTables = rankingSection
      ? Array.from(rankingSection.querySelectorAll("table.rank_section, table.ranking_top + table"))
      : [];
    const rankingRows = rankingTables
      .flatMap((table) => parseTableRows(table))
      .filter((cells) => cells.length >= 3 && !/rank no|category name|stream/i.test(cells.join(" ")));
    const rankings = rankingRows.map((cells) => ({
      rank: cells[0] || null,
      category: cells[1] || "",
      stream: cells[2] || "",
      yearDetails: cells.slice(3).join(" ").trim(),
    }));

    const brochureSection = findSectionByHeading("College Brochure");
    const brochureRows = parseTableRows(brochureSection?.querySelector("table") ?? null).filter(
      (cells) => cells.length >= 3 && !/^type$/i.test(cells[0] || ""),
    );
    const brochures = brochureRows.map((cells) => {
      const downloadAnchor = brochureSection?.querySelectorAll("a[href]").length
        ? Array.from(brochureSection.querySelectorAll("a[href]")).find((anchor) =>
            normalize(anchor.textContent || "").toLowerCase() === "download" &&
            normalize(anchor.closest("tr")?.textContent || "").includes(cells[2] || cells[1] || ""),
          )
        : null;

      return {
        type: cells[0] || "",
        stream: cells[1] || "",
        title: cells[2] || "",
        downloadUrl: (downloadAnchor as HTMLAnchorElement | undefined)?.href || null,
      };
    });

    const facultySection = findSectionByHeading("Faculty Details");
    const facultyRows = facultySection
      ? Array.from(facultySection.querySelectorAll("table tr")).map((row) => normalize(row.textContent || ""))
      : [];
    const faculty = facultyRows
      .filter((row) => row && !/faculty details/i.test(row))
      .map((row) => {
        const emailMatch = row.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        const email = emailMatch?.[0] ?? null;
        const withoutEmail = email ? row.replace(email, "").trim() : row;
        const designationMatch = withoutEmail.match(
          /\b(Professor|Associate Professor|Assistant Professor|Lecturer|Dean|Director|Chancellor|Vice Chancellor|Principal|Reader|Faculty)\b/i,
        );
        const designation = designationMatch?.[0] ?? null;
        const name = designation
          ? withoutEmail.replace(new RegExp(designation, "i"), "").trim()
          : withoutEmail;

        return {
          name: normalize(name),
          designation: designation ? normalize(designation) : null,
          email,
        };
      })
      .filter((member) => member.name.length > 2);

    const courseBlocks = Array.from(document.querySelectorAll(".course_detailss.varun, .course_detailss"));
    const seenCourses = new Set<string>();
    const courses: NotopediaCollegeCourseDetail[] = [];

    for (const block of courseBlocks) {
      const detailsTable = block.querySelector("table");
      const detailRows = parseTableRows(detailsTable);
      const detailMap = new Map(detailRows.map(([label, value]) => [label.toLowerCase(), value]));

      const disciplineHeading = Array.from(block.querySelectorAll("h2.cdtitle")).find((heading) =>
        /discipline offered/i.test(normalize(heading.textContent || "")),
      );
      const disciplineContainer = disciplineHeading?.parentElement;
      const disciplines = disciplineContainer
        ? Array.from(disciplineContainer.querySelectorAll("li, a, span, p"))
            .map((element) => normalize(element.textContent || ""))
            .filter((text) => text && !/discipline offered/i.test(text))
        : [];

      const uniqueDisciplines = [...new Set(disciplines)].filter((text) => text.length > 1);

      const eligibilityText = Array.from(block.querySelectorAll("h2.cdtitle, strong, p, li"))
        .filter((element) => /eligibility criteria|required qualification|required entrance exam/i.test(element.textContent || ""))
        .map((element) => normalize(element.textContent || ""))
        .join(" ");

      const requiredQualification =
        eligibilityText.match(/Required Qualification:\s*(.+?)(?=Required Entrance Exam|$)/i)?.[1]?.trim() || null;
      const requiredEntranceExam =
        eligibilityText.match(/Required Entrance Exam:?\s*(.+?)(?=Bookmark|$)/i)?.[1]?.trim() || null;

      const courseKey = [
        detailMap.get("duration") || "",
        detailMap.get("seats") || "",
        detailMap.get("fees") || "",
        uniqueDisciplines.join("|"),
      ].join("::");

      if (!courseKey || seenCourses.has(courseKey)) {
        continue;
      }
      seenCourses.add(courseKey);

      courses.push({
        duration: detailMap.get("duration") || null,
        type: detailMap.get("type") || null,
        seats: detailMap.get("seats") || null,
        fees: detailMap.get("fees") || null,
        disciplines: uniqueDisciplines,
        eligibility: {
          requiredQualification,
          requiredEntranceExam,
          other: eligibilityText ? [eligibilityText] : [],
        },
      });
    }

    const bannerText = normalize(document.querySelector(".bannerdetails")?.textContent || "");
    const applyUrl =
      Array.from(document.querySelectorAll("a[href]"))
        .find((anchor) => /apply now/i.test(normalize(anchor.textContent || "")))
        ?.href || null;

    const overviewAddress =
      typeof overview["College Address"] === "string" ? overview["College Address"] : null;
    const overviewPhone = typeof overview.Contact === "string" ? overview.Contact : null;
    const overviewWebsite =
      typeof overview["College Website"] === "string" ? overview["College Website"] : null;

    return {
      name: normalize(document.querySelector("h1")?.textContent || document.title),
      location: bannerText || overviewAddress,
      address: overviewAddress,
      phone: overviewPhone,
      website: overviewWebsite,
      applyUrl,
      overview,
      placement,
      rankings,
      brochures,
      faculty,
      courses,
    };
  });

  return {
    listId: listItem.id,
    listName: listItem.name,
    listUrl: listItem.url,
    extractedAt: new Date().toISOString(),
    ...extracted,
  };
}

type ScrapeCollegeDetailsBatchOptions = {
  colleges: NotopediaCollegeListItem[];
  batchNumber: number;
  batchSize: number;
  startIndex: number;
  parallelWorkers?: number;
  onProgress?: (info: { completed: number; total: number; collegeName: string }) => void;
};

export async function scrapeNotopediaCollegeDetailsBatch(
  options: ScrapeCollegeDetailsBatchOptions,
): Promise<NotopediaCollegeDetailsBatchResult> {
  const collegesToProcess = options.colleges.slice(
    options.startIndex,
    options.startIndex + options.batchSize,
  );
  const workerCount = Math.max(1, Math.floor(options.parallelWorkers ?? 3));
  const browser = await launchBrowser();

  try {
    const results: NotopediaCollegeDetail[] = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(workerCount, collegesToProcess.length) }, async () => {
      const page = await createConfiguredPage(browser);

      try {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;

          const listItem = collegesToProcess[currentIndex];
          if (!listItem) {
            return;
          }

          const detail = await scrapeNotopediaCollegeDetail(page, listItem);
          results[currentIndex] = detail;

          options.onProgress?.({
            completed: results.filter(Boolean).length,
            total: collegesToProcess.length,
            collegeName: listItem.name,
          });
        }
      } finally {
        await page.close();
      }
    });

    await Promise.all(workers);

    const details = results.filter(Boolean);
    const endIndex = options.startIndex + details.length;

    return {
      scrapedAt: new Date().toISOString(),
      sourceListFile: "",
      batchNumber: options.batchNumber,
      batchSize: options.batchSize,
      startIndex: options.startIndex,
      endIndex,
      processedCount: details.length,
      details,
    };
  } finally {
    await browser.close();
  }
}
