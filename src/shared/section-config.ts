import { SCRAPE_CONFIG, type DetailSectionKey } from "../config/scrape-config.ts";

export function getDetailSectionConfig(sectionKey: DetailSectionKey) {
  return SCRAPE_CONFIG.sections[sectionKey];
}

export function getHomepageSectionTitles(): string[] {
  return Object.values(SCRAPE_CONFIG.sections)
    .filter((section) => section.enabled && section.sectionName !== "Banner Links")
    .map((section) => section.sectionName);
}
