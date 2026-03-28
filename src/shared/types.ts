export type NotificationItem = {
  title: string;
  url: string;
};

export type NotificationSection = {
  title: string;
  viewMoreUrl: string | null;
  count: number;
  items: NotificationItem[];
};

export type LatestNotificationsResult = {
  scrapedAt: string;
  source: string;
  sectionCount: number;
  bannerLinks: NotificationItem[];
  latestSections: Record<string, NotificationSection>;
};

export type KeyValueRow = {
  label: string;
  value: string;
};

export type LinkRow = {
  label: string;
  url: string;
  linkTitle?: string | null;
};

export type JobDetailResult = {
  listTitle: string;
  listUrl: string;
  extractedAt: string;
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

export type JobDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: JobDetailResult[];
};

export type AdmitCardDetailResult = JobDetailResult;

export type AdmitCardDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: AdmitCardDetailResult[];
};

export type ResultDetailResult = JobDetailResult;

export type ResultDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: ResultDetailResult[];
};

export type AnswerKeyDetailResult = JobDetailResult;

export type AnswerKeyDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: AnswerKeyDetailResult[];
};

export type SyllabusDetailResult = JobDetailResult;

export type SyllabusDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: SyllabusDetailResult[];
};

export type AdmissionDetailResult = JobDetailResult;

export type AdmissionDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: AdmissionDetailResult[];
};

export type BannerDetailResult = JobDetailResult;

export type BannerDetailsOutput = {
  scrapedAt: string;
  sourceListFile: string;
  processedCount: number;
  items: BannerDetailResult[];
};
