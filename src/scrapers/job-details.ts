import type { Page } from "playwright";
import { PAGE_SETTLE_DELAY_MS } from "../shared/constants.ts";
import type { JobDetailResult, KeyValueRow, LinkRow, NotificationItem } from "../shared/types.ts";
import { normalizeText, uniqueByKey } from "../shared/utils.ts";

type RawJobDetail = {
  nameOfPost: string | null;
  vacancy: string | null;
  postDateOrUpdate: string | null;
  shortInformation: string | null;
  organization: LinkRow[];
  importantDates: KeyValueRow[];
  applicationFee: KeyValueRow[];
  ageLimit: KeyValueRow[];
  howToApply: string[];
  usefulLinks: LinkRow[];
};

type UsefulLinkRow = {
  label: string;
  valueCell: Element | null;
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
    const buildLinkTitle = (titles: string[]) => {
      const cleanedTitles = titles
        .map((title) => normalize(title))
        .filter((title) => title && title.toLowerCase() !== "click here");

      if (cleanedTitles.length === 0) {
        return null;
      }

      return cleanedTitles.join(" | ");
    };
    const removeBrandingNoise = (value: string) =>
      value
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => {
          const lower = line.toLowerCase();
          return !(
            lower.includes("sarkari result") ||
            lower.includes("sarkariresult.com") ||
            lower.includes("join") && lower.includes("channel") ||
            lower.includes("android app") ||
            lower.includes("apple ios app") ||
            lower.includes("telegram") ||
            lower.includes("whatsapp") ||
            lower.includes("registered trademark") ||
            lower.includes("intellectual property india") ||
            lower.includes("feedback / advertising")
          );
        })
        .join("\n");
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

    const bodyText = normalize(
      removeBrandingNoise(
        (document.body.innerText || "")
        .replace(/\(adsbygoogle\s*=\s*window\.adsbygoogle\s*\|\|\s*\[\]\)\.push\(\{\}\);?/gi, " ")
        .replace(/\(function\(v,d,o,ai\)\{[\s\S]*?\}\)\(window,\s*document,[\s\S]*?\);?/gi, " "),
      ),
    );

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const buildBoundary = (labels: string[]) => labels.map(escapeRegex).join("|");

    const extractSingleValue = (label: string, nextLabels: string[]) => {
      const regex = new RegExp(
        `${escapeRegex(label)}\\s*:?\\s*([\\s\\S]*?)(?=(?:${buildBoundary(nextLabels)})\\s*:|$)`,
        "i",
      );
      const match = bodyText.match(regex);
      return match?.[1] ? normalize(match[1]) : null;
    };

    const extractSection = (startLabels: string[], endLabels: string[]) => {
      const regex = new RegExp(
        `(?:${buildBoundary(startLabels)})\\s*:?\\s*([\\s\\S]*?)(?=(?:${buildBoundary(endLabels)})\\s*:|$)`,
        "i",
      );
      const match = bodyText.match(regex);
      return match?.[1] ? normalize(match[1]) : "";
    };

    const getListItemsForHeading = (matcher: (text: string) => boolean) => {
      const headings = Array.from(document.querySelectorAll("td, th, b, strong, h1, h2, h3, h4, div, span"));

      for (const heading of headings) {
        const text = normalize(heading.textContent || "");
        if (!matcher(text.toLowerCase())) {
          continue;
        }

        const nearestCell = heading.closest("td, th");
        if (nearestCell) {
          const cellItems = Array.from(nearestCell.querySelectorAll("li"))
            .map((item) => normalize(item.textContent || ""))
            .filter(Boolean);

          if (cellItems.length > 0) {
            return cellItems;
          }
        }

        let sibling: Element | null = heading.nextElementSibling;
        while (sibling) {
          const siblingItems = Array.from(sibling.querySelectorAll("li"))
            .map((item) => normalize(item.textContent || ""))
            .filter(Boolean);

          if (siblingItems.length > 0) {
            return siblingItems;
          }

          sibling = sibling.nextElementSibling;
        }

        let container: Element | null = heading.parentElement;
        while (container) {
          const directLists = Array.from(container.children)
            .flatMap((child) => Array.from(child.querySelectorAll("li")))
            .map((item) => normalize(item.textContent || ""))
            .filter(Boolean);

          if (directLists.length > 0) {
            return directLists;
          }

          container = container.parentElement;
        }
      }

      return [] as string[];
    };

    const parseKeyValueBlock = (text: string) =>
      Array.from(
        text.matchAll(/([A-Za-z][A-Za-z /()]+?)\s*:\s*([^:]+?)(?=\s+[A-Za-z][A-Za-z /()]+?\s*:|$)/g),
      )
        .map((match) => ({
          label: normalize(match[1] || ""),
          value: normalize(match[2] || ""),
        }))
        .filter((item) => item.label && item.value);

    const parseListKeyValueBlock = (items: string[]) =>
      items
        .map((item) => {
          const match = item.match(/^(.+?)\s*:\s*(.+)$/);
          const label = match?.[1];
          const value = match?.[2];
          if (!label || !value) {
            return null;
          }

          return {
            label: normalize(label),
            value: normalize(value),
          };
        })
        .filter((item): item is KeyValueRow => Boolean(item));

    const parseHowToApply = (text: string) =>
      text
        .split(/\.\s+|\s(?=First:)|\s(?=Second\s*:)|\s(?=Kindly )|\s(?=Before Apply)|\s(?=Take A Print)/)
        .map((item) => normalize(item))
        .filter((item) => item.length > 10);

    const getLabeledValueCell = (labelText: string) => {
      const cells = Array.from(document.querySelectorAll("td, th"));

      for (const cell of cells) {
        const text = normalize(cell.textContent || "").toLowerCase();
        if (!text.startsWith(labelText.toLowerCase())) {
          continue;
        }

        const row = cell.closest("tr");
        if (!row) {
          continue;
        }

        const rowCells = Array.from(row.querySelectorAll("td, th"));
        const cellIndex = rowCells.indexOf(cell);
        if (cellIndex === -1 || rowCells.length <= cellIndex + 1) {
          continue;
        }

        const valueCell = rowCells[cellIndex + 1];
        if (valueCell) {
          return valueCell;
        }
      }

      return null;
    };

    const getUsefulLinkRows = () => {
      const cells = Array.from(document.querySelectorAll("td, th"));
      const startCell = cells.find(
        (cell) => normalize(cell.textContent || "").toLowerCase() === "some useful important links",
      );

      if (!startCell) {
        return [] as UsefulLinkRow[];
      }

      const startRow = startCell.closest("tr");
      let currentRow: Element | null = startRow ? startRow.nextElementSibling : null;
      const rows: UsefulLinkRow[] = [];

      while (currentRow) {
        const rowCells = Array.from(currentRow.querySelectorAll("td, th"));
        if (rowCells.length < 2) {
          break;
        }

        const labelCell = rowCells[0];
        const valueCell = rowCells[1];
        if (!labelCell || !valueCell) {
          currentRow = currentRow.nextElementSibling;
          continue;
        }

        const label = normalize(labelCell.textContent || "");
        if (!label) {
          currentRow = currentRow.nextElementSibling;
          continue;
        }

        rows.push({
          label,
          valueCell,
        });

        currentRow = currentRow.nextElementSibling;
      }

      return rows;
    };

    const shortInformation =
      extractSingleValue("Short Information", [
        "Important Dates",
        "Application Fee",
        "Age Limit",
        "How to Fill",
        "How to Apply",
        "Some Useful Important Links",
      ]) || null;

    const shortInformationValueCell = getLabeledValueCell("Short Information");
    const organization = shortInformationValueCell
      ? Array.from(shortInformationValueCell.querySelectorAll("a[href]"))
          .map((anchor) => {
            const label = normalize(anchor.textContent || "");
            const url = toAbsoluteUrl(anchor.getAttribute("href"));
            if (!label || !url) {
              return null;
            }

            const lowerLabel = label.toLowerCase();
            if (
              lowerLabel === "home" ||
              lowerLabel === "result" ||
              lowerLabel === "admit card" ||
              lowerLabel.includes("android apps") ||
              lowerLabel.includes("apple ios apps")
            ) {
              return null;
            }

            return { label, url };
          })
          .filter((item): item is LinkRow => Boolean(item))
      : [];

    const importantDatesList = getListItemsForHeading(
      (text) => text === "important dates" || text === "important date",
    );
    const applicationFeeList = getListItemsForHeading((text) => text === "application fee");
    const ageLimitList = getListItemsForHeading((text) => text.includes("age limit"));

    const importantDatesText = extractSection(
      ["Important Dates"],
      ["Application Fee", "Age Limit", "How to Fill", "How to Apply", "Some Useful Important Links"],
    );
    const applicationFeeText = extractSection(
      ["Application Fee"],
      ["Age Limit", "How to Fill", "How to Apply", "Some Useful Important Links"],
    );
    const ageLimitText = extractSection(
      ["Age Limit", "Age Limit as on", "Age Limit as On"],
      ["How to Fill", "How to Apply", "Some Useful Important Links"],
    );
    const howToApplyText = extractSection(
      ["How to Fill", "How to Apply"],
      ["Interested Candidates Can Read", "Some Useful Important Links", "Download SarkariResult.Com Official Mobile Apps"],
    );

    const usefulLinks = getUsefulLinkRows()
      .map((row) => {
        const lowerLabel = row.label.toLowerCase();
        if (!row.valueCell) {
          return null;
        }

        if (
          lowerLabel.includes("join") && lowerLabel.includes("channel") ||
          lowerLabel.includes("portal") ||
          lowerLabel.includes("resume cv maker") ||
          lowerLabel.includes("image resizer") ||
          lowerLabel.includes("jpg to pdf") ||
          lowerLabel.includes("typing test practice") ||
          lowerLabel.includes("android app") ||
          lowerLabel.includes("apple ios app")
        ) {
          return null;
        }

        const urls = Array.from(row.valueCell.querySelectorAll("a[href]"))
          .map((anchor) => ({
            text: normalize(anchor.textContent || ""),
            url: toAbsoluteUrl(anchor.getAttribute("href")),
          }))
          .filter((entry): entry is { text: string; url: string } => Boolean(entry.text && entry.url));

        if (urls.length === 0) {
          return null;
        }

        return {
          label: row.label,
          linkTitle: buildLinkTitle(urls.map((entry) => entry.text)),
          url: urls.map((entry) => entry.url).join(" | "),
        };
      })
      .filter((item): item is LinkRow => Boolean(item));

    const vacancyMatch = bodyText.match(/vacancy details total\s*:\s*(\d+)\s*post/i);

    return {
      nameOfPost: extractSingleValue("Name of Post", ["Post Date / Update", "Short Information"]),
      vacancy: vacancyMatch?.[1] || null,
      postDateOrUpdate: extractSingleValue("Post Date / Update", ["Short Information", "Important Dates"]),
      shortInformation,
      organization,
      importantDates:
        importantDatesList.length > 0 ? parseListKeyValueBlock(importantDatesList) : parseKeyValueBlock(importantDatesText),
      applicationFee:
        applicationFeeList.length > 0 ? parseListKeyValueBlock(applicationFeeList) : parseKeyValueBlock(applicationFeeText),
      ageLimit: ageLimitList.length > 0 ? parseListKeyValueBlock(ageLimitList) : parseKeyValueBlock(ageLimitText),
      howToApply: parseHowToApply(howToApplyText),
      usefulLinks,
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
    organization: normalizeLinkRows(extracted.organization),
    importantDates: normalizeKeyValueRows(extracted.importantDates),
    applicationFee: normalizeKeyValueRows(extracted.applicationFee),
    ageLimit: normalizeAgeLimitRows(extracted.ageLimit),
    howToApply: uniqueByKey(
      extracted.howToApply.map((item) => normalizeText(item)),
      (item) => item,
    ),
    usefulLinks: normalizeLinkRows(extracted.usefulLinks),
  };
}

function normalizeNullableText(value: string | null): string | null {
  return value ? normalizeText(value) : null;
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
    organization: [],
    importantDates: [],
    applicationFee: [],
    ageLimit: [],
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
  const normalizedRows = normalizeKeyValueRows(rows);

  return normalizedRows.filter((row) => {
    const label = row.label.toLowerCase();
    const value = row.value.toLowerCase();

    return (
      label.includes("age") ||
      value.includes("year") ||
      value.includes("years")
    );
  });
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
