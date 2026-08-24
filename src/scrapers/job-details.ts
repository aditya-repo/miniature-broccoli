import type { Page } from "playwright";
import { PAGE_SETTLE_DELAY_MS } from "../shared/constants.ts";
import type {
  JobDetailResult,
  KeyValueRow,
  LinkRow,
  NotificationItem,
  VacancyDetailRow,
} from "../shared/types.ts";
import { normalizeText, uniqueByKey } from "../shared/utils.ts";

type RawJobDetail = {
  nameOfPost: string | null;
  vacancy: string | null;
  postDateOrUpdate: string | null;
  shortInformation: string | null;
  organization: string | null;
  organizationShortName: string | null;
  organizationConfirmed: boolean;
  importantDates: KeyValueRow[];
  applicationFee: KeyValueRow[];
  ageLimit: KeyValueRow[];
  vacancyDetails: VacancyDetailRow[];
  howToApply: string[];
  usefulLinks: LinkRow[];
};

export async function scrapeJobDetail(page: Page, item: NotificationItem): Promise<JobDetailResult> {
  if (isDirectDownloadUrl(item.url)) {
    return createDirectDownloadDetail(item);
  }

  try {
    await page.goto(item.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 30_000 });
    await page.waitForTimeout(PAGE_SETTLE_DELAY_MS);
  } catch (error: unknown) {
    if (isDownloadStartError(error)) {
      return createDirectDownloadDetail(item);
    }

    throw error;
  }

  const extracted = await page.evaluate((): RawJobDetail => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

    const PROMO_PATTERNS = [
      /join us/gi,
      /instagram follow/gi,
      /\bx follow\b/gi,
      /discover more/gi,
      /sarkari result[®\s]*(official)?/gi,
      /sarkariresult\.com/gi,
      /download the sarkari result[\s\S]*$/gi,
    ];

    const stripPromo = (value: string) => {
      let output = value;
      for (const pattern of PROMO_PATTERNS) {
        output = output.replace(pattern, " ");
      }
      return normalize(output);
    };

    const isPromoText = (value: string) => {
      const lower = value.toLowerCase();
      return (
        lower.includes("sarkari result") ||
        lower.includes("sarkariresult.com") ||
        lower.includes("android app") ||
        lower.includes("apple ios app") ||
        lower.includes("telegram") ||
        lower.includes("whatsapp") ||
        lower.includes("instagram") ||
        lower.includes("registered trademark") ||
        lower.includes("intellectual property india") ||
        lower.includes("feedback / advertising") ||
        (lower.includes("join") && lower.includes("channel"))
      );
    };

    const toAbsoluteUrl = (href: string | null) => {
      if (!href) {
        return null;
      }

      try {
        return new URL(href, location.href).toString();
      } catch {
        return null;
      }
    };

    const buildLinkTitle = (titles: string[]) => {
      const cleanedTitles = titles
        .map((title) => normalize(title))
        .filter((title) => title && title.toLowerCase() !== "click here");

      return cleanedTitles.length > 0 ? cleanedTitles.join(" | ") : null;
    };

    const stripTrailingColon = (value: string) => value.replace(/\s*:\s*$/, "").trim();

    /** Info table is a two-column `label | value` grid at the top of the page. */
    const getInfoValueCell = (labelVariants: string[]) => {
      const wanted = labelVariants.map((variant) => variant.toLowerCase());
      const cells = Array.from(document.querySelectorAll("td, th"));

      for (const cell of cells) {
        const label = stripTrailingColon(normalize(cell.textContent || "")).toLowerCase();
        if (!wanted.includes(label)) {
          continue;
        }

        const row = cell.closest("tr");
        if (!row) {
          continue;
        }

        const rowCells = Array.from(row.querySelectorAll("td, th"));
        const index = rowCells.indexOf(cell);
        const valueCell = index >= 0 ? rowCells[index + 1] : undefined;
        if (valueCell) {
          return valueCell;
        }
      }

      return null;
    };

    const getInfoValue = (labelVariants: string[]) => {
      const cell = getInfoValueCell(labelVariants);
      if (!cell) {
        return null;
      }

      const text = normalize(cell.textContent || "");
      return text || null;
    };

    /**
     * Section content lives in a table cell introduced by a short heading
     * (e.g. "Important Dates", "... : Age Limit"). Headings are matched before
     * bold text so a bolded label inside a list cannot hijack the section.
     */
    const findSectionCell = (matcher: (text: string) => boolean) => {
      const passes = [
        Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")),
        Array.from(document.querySelectorAll("b, strong")),
      ];

      for (const candidates of passes) {
        for (const candidate of candidates) {
          const text = normalize(candidate.textContent || "");
          if (!text || text.length > 160) {
            continue;
          }

          if (!matcher(text.toLowerCase())) {
            continue;
          }

          const cell = candidate.closest("td, th");
          if (cell) {
            return cell;
          }
        }
      }

      return null;
    };

    const findHeadingText = (matcher: (text: string) => boolean) => {
      const candidates = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, b, strong, td, th"));

      for (const candidate of candidates) {
        const text = normalize(candidate.textContent || "");
        if (text && text.length <= 200 && matcher(text.toLowerCase())) {
          return text;
        }
      }

      return null;
    };

    const getCellListItems = (cell: Element | null) =>
      cell
        ? Array.from(cell.querySelectorAll("li"))
            .map((listItem) => normalize(listItem.textContent || ""))
            .filter(Boolean)
        : [];

    /**
     * Splits `Label : Value` list items, carrying group headers
     * (e.g. "For Group A :") into following labels so repeated
     * fee/date labels stay distinguishable.
     */
    const parseKeyValueItems = (items: string[]): KeyValueRow[] => {
      const rows: KeyValueRow[] = [];
      let group: string | null = null;

      for (const item of items) {
        if (isPromoText(item)) {
          continue;
        }

        const match = item.match(/^(.+?)\s*:\s*(.+)$/);
        const label = match?.[1] ? normalize(match[1]) : "";
        const value = match?.[2] ? normalize(match[2]) : "";

        if (!label || !value) {
          const header = stripTrailingColon(item);
          // A colon-terminated item without a value introduces a group.
          if (/:\s*$/.test(item) && header && header.length <= 80) {
            group = header;
          }
          continue;
        }

        rows.push({
          label: group ? `${group} - ${label}` : label,
          value,
        });
      }

      return rows;
    };

    /** Fallback for sections rendered as prose instead of a list. */
    const parseKeyValueText = (text: string): KeyValueRow[] =>
      Array.from(
        text.matchAll(/([A-Za-z][A-Za-z /()]+?)\s*:\s*([^:]+?)(?=\s+[A-Za-z][A-Za-z /()]+?\s*:|$)/g),
      )
        .map((match) => ({
          label: normalize(match[1] || ""),
          value: normalize(match[2] || ""),
        }))
        .filter((row) => row.label && row.value && !isPromoText(row.label));

    const getSectionRows = (matcher: (text: string) => boolean, headingMatcher: (text: string) => boolean) => {
      const cell = findSectionCell(matcher);
      const listItems = getCellListItems(cell);
      if (listItems.length > 0) {
        return parseKeyValueItems(listItems);
      }

      if (!cell) {
        return [] as KeyValueRow[];
      }

      // Drop the heading itself before parsing the remaining prose.
      const cellText = normalize(cell.textContent || "");
      const heading = Array.from(cell.querySelectorAll("h1, h2, h3, h4, h5, h6, b, strong")).find((element) =>
        headingMatcher(normalize(element.textContent || "").toLowerCase()),
      );
      const headingText = heading ? normalize(heading.textContent || "") : "";
      const body = headingText && cellText.startsWith(headingText)
        ? cellText.slice(headingText.length)
        : cellText;

      return parseKeyValueText(body);
    };

    const isImportantDatesHeading = (text: string) => {
      const cleaned = stripTrailingColon(text);
      return cleaned.endsWith("important dates") || cleaned.endsWith("important date");
    };
    const isApplicationFeeHeading = (text: string) => text.includes("application fee");
    const isAgeLimitHeading = (text: string) => text.includes("age limit");
    const isHowToApplyHeading = (text: string) =>
      text.includes("how to fill") || text.includes("how to apply") || text.includes("how to online form");

    const nameOfPost =
      getInfoValue(["name of post", "name of the post"]) ||
      normalize(document.querySelector("h1")?.textContent || "") ||
      null;

    const postDateOrUpdate = getInfoValue([
      "post date / update",
      "post date/update",
      "post date / updated",
      "post date",
      "post update",
    ]);

    const shortInformationCell = getInfoValueCell(["short information", "short info", "short details"]);
    const shortInformation = shortInformationCell
      ? stripPromo(normalize(shortInformationCell.textContent || "")) || null
      : null;

    /**
     * The organization is published twice: as the leading "Full Name (SHORT)"
     * phrase of Short Information, and as the first heading of the content
     * table. Comparing both guards against picking up an unrelated heading.
     * Brackets are optional in prose ("National Testing Agency NTA"), so the
     * comparison key drops punctuation entirely.
     */
    const organizationKey = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    /** "(CCRUM)" is an abbreviation; "(Graduate)" is part of a post name. */
    const isAbbreviation = (value: string) => {
      const letters = value.replace(/[^A-Za-z]/g, "");
      if (letters.length < 2) {
        return false;
      }

      const upperCount = value.replace(/[^A-Z]/g, "").length;
      return upperCount / letters.length >= 0.6;
    };

    const bracketAbbreviation = (value: string) => {
      const inner = normalize(value.match(/\(\s*([^)]{1,30})\s*\)\s*$/)?.[1] || "");
      return inner && isAbbreviation(inner) ? inner : null;
    };

    // The first non-branding <h2> is the organization row of the content table.
    const organizationFromTable =
      Array.from(document.querySelectorAll("h2"))
        .map((heading) => normalize(heading.textContent || ""))
        .find((text) => text && text.length <= 150 && !isPromoText(text) && !/^www\./i.test(text)) || null;

    const organizationFromShortInfo = (() => {
      if (!shortInformation) {
        return null;
      }

      const match = shortInformation.match(/^(.{3,140}?)\s*\(\s*([A-Za-z][A-Za-z0-9&.\/\- ]{1,25})\s*\)/);
      const name = match?.[1] ? normalize(match[1]) : "";
      const shortName = match?.[2] ? normalize(match[2]) : "";
      // Guard against trailing post-name brackets such as "... (Graduate)".
      return name && shortName && isAbbreviation(shortName) ? `${name} (${shortName})` : null;
    })();

    const organizationIsConfirmed = (() => {
      if (!organizationFromTable || !shortInformation) {
        return false;
      }

      const tableKey = organizationKey(organizationFromTable);
      if (tableKey && organizationKey(shortInformation).includes(tableKey)) {
        return true;
      }

      // Prose often drops the brackets, leaving only the abbreviation.
      const abbreviation = bracketAbbreviation(organizationFromTable);
      return Boolean(
        abbreviation && new RegExp(`\\b${abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(shortInformation),
      );
    })();

    // The table heading is the dedicated organization row, so it wins unless absent.
    const organization = organizationFromTable || organizationFromShortInfo || null;
    const organizationShortName = organization ? bracketAbbreviation(organization) : null;

    const importantDates = getSectionRows(isImportantDatesHeading, isImportantDatesHeading);
    const applicationFee = getSectionRows(isApplicationFeeHeading, isApplicationFeeHeading);
    const ageLimit = getSectionRows(isAgeLimitHeading, isAgeLimitHeading);

    const howToApplyCell = findSectionCell(isHowToApplyHeading);
    const howToApplyItems = getCellListItems(howToApplyCell);
    const howToApply = (howToApplyItems.length > 0
      ? howToApplyItems
      : normalize(howToApplyCell?.textContent || "")
          .split(/(?<=\.)\s+/)
          .map((sentence) => normalize(sentence)))
      .filter((entry) => entry.length > 10 && !isPromoText(entry) && !isHowToApplyHeading(entry.toLowerCase()));

    /** Vacancy grid: `Post Name | Total Post | Eligibility`, with group header rows. */
    const getVacancyDetails = (): VacancyDetailRow[] => {
      // The first column label varies by section (Post / Exam / Course / Trade name).
      const isNameColumn = (text: string) =>
        /^(post|exam|course|trade|subject|branch|category|group)\s*name$/.test(text) ||
        text === "name of post" ||
        text === "name of the post";
      const isCountColumn = (text: string) =>
        text.startsWith("total post") ||
        text.startsWith("no of post") ||
        text.startsWith("no. of post") ||
        text === "total" ||
        text === "total seats" ||
        text === "seats";

      const headerRow = Array.from(document.querySelectorAll("tr")).find((row) => {
        const cells = Array.from(row.cells).map((cell) => normalize(cell.textContent || "").toLowerCase());
        return cells.length >= 2 && cells.some(isNameColumn) && cells.some(isCountColumn);
      });

      if (!headerRow) {
        return [];
      }

      const isStopRow = (text: string) =>
        isHowToApplyHeading(text) ||
        text.includes("some useful important links") ||
        text.includes("interested candidates can read");

      const rows: VacancyDetailRow[] = [];
      let group: string | null = null;
      let current: Element | null = headerRow.nextElementSibling;

      while (current) {
        const cells = Array.from((current as HTMLTableRowElement).cells || []);
        const rowText = normalize(current.textContent || "");
        const lowerRowText = rowText.toLowerCase();

        if (isStopRow(lowerRowText)) {
          break;
        }

        if (cells.length === 1) {
          // Short single-cell rows are group headers; long ones start a new section.
          if (rowText.length > 120 || isPromoText(rowText)) {
            break;
          }

          group = rowText || group;
          current = current.nextElementSibling;
          continue;
        }

        const postName = normalize(cells[0]?.textContent || "");
        const totalPost = normalize(cells[1]?.textContent || "") || null;
        const eligibilityCell = cells[2] ?? null;
        const eligibility = getCellListItems(eligibilityCell);

        // Link rows ("Apply Online | Click Here") mean the grid has ended.
        if (cells[1]?.querySelector("a[href]") && /^(click here|download|apply online)/i.test(totalPost || "")) {
          break;
        }

        if (postName && !isPromoText(postName)) {
          rows.push({
            group,
            postName,
            totalPost,
            eligibility:
              eligibility.length > 0
                ? eligibility
                : [normalize(eligibilityCell?.textContent || "")].filter(Boolean),
          });
        }

        current = current.nextElementSibling;
      }

      return rows;
    };

    const vacancyDetails = getVacancyDetails();

    const getUsefulLinks = (): LinkRow[] => {
      const cells = Array.from(document.querySelectorAll("td, th"));
      const startCell = cells.find(
        (cell) => normalize(cell.textContent || "").toLowerCase() === "some useful important links",
      );

      if (!startCell) {
        return [];
      }

      const links: LinkRow[] = [];
      let current: Element | null = startCell.closest("tr")?.nextElementSibling ?? null;

      while (current) {
        const rowCells = Array.from(current.querySelectorAll("td, th"));
        if (rowCells.length < 2) {
          break;
        }

        const label = normalize(rowCells[0]?.textContent || "");
        const valueCell = rowCells[1];
        if (!label || !valueCell) {
          current = current.nextElementSibling;
          continue;
        }

        const lowerLabel = label.toLowerCase();
        const isNoise =
          (lowerLabel.includes("join") && lowerLabel.includes("channel")) ||
          lowerLabel.includes("portal") ||
          lowerLabel.includes("resume cv maker") ||
          lowerLabel.includes("image resizer") ||
          lowerLabel.includes("jpg to pdf") ||
          lowerLabel.includes("typing test practice") ||
          lowerLabel.includes("android app") ||
          lowerLabel.includes("apple ios app");

        if (isNoise) {
          current = current.nextElementSibling;
          continue;
        }

        const urls = Array.from(valueCell.querySelectorAll("a[href]"))
          .map((anchor) => ({
            text: normalize(anchor.textContent || ""),
            url: toAbsoluteUrl(anchor.getAttribute("href")),
          }))
          .filter((entry): entry is { text: string; url: string } => Boolean(entry.text && entry.url));

        if (urls.length > 0) {
          links.push({
            label,
            linkTitle: buildLinkTitle(urls.map((entry) => entry.text)),
            url: urls.map((entry) => entry.url).join(" | "),
          });
        }

        current = current.nextElementSibling;
      }

      return links;
    };

    const extractVacancyTotal = () => {
      const vacancyHeading = findHeadingText(
        (text) => text.includes("vacancy details") || /total\s*:?\s*[\d,]+\s*post/i.test(text),
      );

      // Explicit totals are safe to read from anywhere on the page.
      const explicitPatterns = [
        /vacancy details\s*total\s*:?\s*([\d,]+)/i,
        /total\s*:?\s*([\d,]+)\s*posts?\b/i,
        /total posts?\s*:?\s*([\d,]+)/i,
      ];
      // A bare "N Post" is only trustworthy inside a vacancy heading or title.
      const loosePatterns = [/for\s+([\d,]+)\s+posts?\b/i, /([\d,]+)\s+posts?\b/i];

      const readTotal = (source: string, patterns: RegExp[]) => {
        for (const pattern of patterns) {
          const match = source.match(pattern);
          const value = match?.[1]?.replace(/,/g, "");
          if (value && Number(value) > 0) {
            return value;
          }
        }

        return null;
      };

      const bodyText = normalize(document.body?.innerText || "");
      for (const source of [vacancyHeading, nameOfPost, bodyText]) {
        const total = source ? readTotal(source, explicitPatterns) : null;
        if (total) {
          return total;
        }
      }

      for (const source of [vacancyHeading, nameOfPost]) {
        const total = source ? readTotal(source, loosePatterns) : null;
        if (total) {
          return total;
        }
      }

      // Sum the vacancy grid when no explicit total is published.
      const summed = vacancyDetails
        .map((row) => Number((row.totalPost || "").replace(/[^\d]/g, "")))
        .filter((count) => Number.isFinite(count) && count > 0)
        .reduce((total, count) => total + count, 0);

      return summed > 0 ? String(summed) : null;
    };

    return {
      nameOfPost,
      vacancy: extractVacancyTotal(),
      postDateOrUpdate,
      shortInformation,
      organization,
      organizationShortName,
      organizationConfirmed: organizationIsConfirmed,
      importantDates,
      applicationFee,
      ageLimit,
      vacancyDetails,
      howToApply,
      usefulLinks: getUsefulLinks(),
    };
  });

  return {
    listTitle: item.title,
    listUrl: item.url,
    extractedAt: new Date().toISOString(),
    nameOfPost: normalizeNullableText(extracted.nameOfPost),
    vacancy: normalizeNullableText(extracted.vacancy),
    postDateOrUpdate: normalizeNullableText(extracted.postDateOrUpdate),
    shortInformation: normalizeNullableText(extracted.shortInformation),
    organization: normalizeNullableText(extracted.organization),
    organizationShortName: normalizeNullableText(extracted.organizationShortName),
    organizationConfirmed: extracted.organizationConfirmed,
    importantDates: normalizeKeyValueRows(extracted.importantDates),
    applicationFee: normalizeKeyValueRows(extracted.applicationFee),
    ageLimit: normalizeAgeLimitRows(extracted.ageLimit),
    vacancyDetails: normalizeVacancyRows(extracted.vacancyDetails),
    howToApply: uniqueByKey(
      extracted.howToApply.map((entry) => normalizeText(entry)),
      (entry) => entry,
    ),
    usefulLinks: normalizeLinkRows(extracted.usefulLinks),
  };
}

function normalizeNullableText(value: string | null): string | null {
  return value ? normalizeText(value) || null : null;
}

function isDirectDownloadUrl(url: string): boolean {
  return /\.(pdf|doc|docx|xls|xlsx|zip)(?:$|[?#])/i.test(url);
}

function isDownloadStartError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Download is starting");
}

function createDirectDownloadDetail(item: NotificationItem): JobDetailResult {
  return {
    listTitle: item.title,
    listUrl: item.url,
    extractedAt: new Date().toISOString(),
    nameOfPost: item.title,
    vacancy: null,
    postDateOrUpdate: null,
    shortInformation: null,
    organization: null,
    organizationShortName: null,
    organizationConfirmed: false,
    importantDates: [],
    applicationFee: [],
    ageLimit: [],
    vacancyDetails: [],
    howToApply: [],
    usefulLinks: [
      {
        label: "Download File",
        url: item.url,
        linkTitle: null,
      },
    ],
  };
}

function normalizeKeyValueRows(rows: KeyValueRow[]): KeyValueRow[] {
  return uniqueByKey(
    rows.map((row) => ({
      label: normalizeText(row.label),
      value: normalizeText(row.value),
    })),
    (row) => `${row.label}::${row.value}`,
  );
}

function normalizeAgeLimitRows(rows: KeyValueRow[]): KeyValueRow[] {
  return normalizeKeyValueRows(rows).filter((row) => {
    const label = row.label.toLowerCase();
    const value = row.value.toLowerCase();

    return label.includes("age") || value.includes("year");
  });
}

function normalizeVacancyRows(rows: VacancyDetailRow[]): VacancyDetailRow[] {
  return uniqueByKey(
    rows.map((row) => ({
      group: row.group ? normalizeText(row.group) : null,
      postName: normalizeText(row.postName),
      totalPost: row.totalPost ? normalizeText(row.totalPost) : null,
      eligibility: row.eligibility.map((entry) => normalizeText(entry)).filter(Boolean),
    })),
    (row) => `${row.group || ""}::${row.postName}::${row.totalPost || ""}`,
  );
}

function normalizeLinkRows(rows: LinkRow[]): LinkRow[] {
  return uniqueByKey(
    rows.map((row) => ({
      label: normalizeText(row.label),
      url: row.url,
      linkTitle: row.linkTitle ? normalizeText(row.linkTitle) : null,
    })),
    (row) => `${row.label}::${row.url}::${row.linkTitle || ""}`,
  );
}
