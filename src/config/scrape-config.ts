export type DetailSectionKey =
  | "banner"
  | "latestJobs"
  | "admitCard"
  | "result"
  | "answerKey"
  | "syllabus"
  | "admission";

export type DetailSectionConfig = {
  enabled: boolean;
  displayName: string;
  sectionName: string;
  outputFile: string;
  collectionName: string;
  manualUrl: string;
  limit: number;
};

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export const SCRAPE_CONFIG: {
  homepage: {
    includeBannerLinks: boolean;
    outputFile: string;
    collectionName: string;
  };
  output: {
    local: boolean;
    remote: boolean;
    mongoUriEnvVar: string;
  };
  detailScraping: {
    parallelWorkers: number;
  };
  sections: Record<DetailSectionKey, DetailSectionConfig>;
} = {
  homepage: {
    includeBannerLinks: true,
    outputFile: "output/latest-notifications.json",
    collectionName: "homepage_lists",
  },
  output: {
    local: readBooleanEnv("SCRAPE_OUTPUT_LOCAL", true),
    remote: readBooleanEnv("SCRAPE_OUTPUT_REMOTE", false),
    mongoUriEnvVar: process.env.SCRAPE_MONGO_URI_ENV_VAR || "MONGODB_URI",
  },
  detailScraping: {
    parallelWorkers: readNumberEnv("SCRAPE_PARALLEL_WORKERS", 5),
  },
  sections: {
    banner: {
      enabled: true,
      displayName: "Banner Links",
      sectionName: "Banner Links",
      outputFile: "output/banner-link-details.json",
      collectionName: "banner_details",
      manualUrl: "",
      limit: 25,
    },
    latestJobs: {
      enabled: true,
      displayName: "Latest Jobs",
      sectionName: "Latest Jobs",
      outputFile: "output/latest-job-details.json",
      collectionName: "latest_job_details",
      manualUrl: "",
      limit: 25,
    },
    admitCard: {
      enabled: true,
      displayName: "Admit Card",
      sectionName: "Admit Card",
      outputFile: "output/admit-card-details.json",
      collectionName: "admit_card_details",
      manualUrl: "",
      limit: 25,
    },
    result: {
      enabled: true,
      displayName: "Result",
      sectionName: "Result",
      outputFile: "output/result-details.json",
      collectionName: "result_details",
      manualUrl: "",
      limit: 25,
    },
    answerKey: {
      enabled: true,
      displayName: "Answer Key",
      sectionName: "Answer Key",
      outputFile: "output/answer-key-details.json",
      collectionName: "answer_key_details",
      manualUrl: "",
      limit: 25,
    },
    syllabus: {
      enabled: true,
      displayName: "Syllabus",
      sectionName: "Syllabus",
      outputFile: "output/syllabus-details.json",
      collectionName: "syllabus_details",
      manualUrl: "",
      limit: 25,
    },
    admission: {
      enabled: true,
      displayName: "Admission",
      sectionName: "Admission",
      outputFile: "output/admission-details.json",
      collectionName: "admission_details",
      manualUrl: "",
      limit: 25,
    },
  },
};
