export type ScanMode = "auto" | "handle" | "mail" | "host" | "phone" | "crawl";
export type DetectedKind = "handle" | "mail" | "host" | "phone" | "crawl";

export type LedgerStatus =
  | "found"
  | "miss"
  | "blocked"
  | "escalate"
  | "error"
  | "invalid";

export type LedgerCategory =
  | "social"
  | "coding"
  | "gaming"
  | "tech"
  | "hobby"
  | "blog"
  | "business"
  | "finance"
  | "music"
  | "shopping"
  | "images"
  | "video"
  | "news"
  | "dating"
  | "political"
  | "health"
  | "art"
  | "search"
  | "archived"
  | "misc"
  | "identity"
  | "oracle"
  | "dns"
  | "rdap"
  | "tls"
  | "phone"
  | "graph"
  | "nsfw"
  | "crawl"
  | "ai";

export interface MetadataCard {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  followers?: number;
  following?: number;
  location?: string;
  website?: string;
  extra?: Record<string, string | number | boolean | null>;
  phash?: string;
}

export interface LedgerRow {
  id: string;
  scanId: string;
  mode: DetectedKind;
  target: string;
  site: string;
  category: string;
  status: LedgerStatus;
  reason: string;
  url: string;
  profileUrl?: string;
  method: string;
  httpStatus?: number;
  finalUrl?: string;
  redirectChain?: string[];
  bodyExcerpt?: string;
  latencyMs?: number;
  metadata?: MetadataCard;
  protection?: string[];
  phash?: string;
  via?: "undici" | "curl-impersonate" | "playwright";
  /** Match confidence — high beats medium/low when ranking founds. */
  confidence?: "high" | "medium" | "low";
  /** Original username when this row is a handle variant. */
  seed?: string;
  /** Mutated handle probed for this row (when different from seed). */
  variant?: string;
}

export interface PreflightResult {
  ok: boolean;
  kind: DetectedKind;
  query: string;
  normalized: string;
  notes: string[];
  warnings: string[];
  errors: string[];
}

export interface DkimSelector {
  selector: string;
  present: boolean;
  raw?: string;
}

export interface LocalPartAnalysis {
  localPart: string;
  plusTag?: string;
  base: string;
  patterns: string[];
  possibleNames: string[];
  trailingYear?: string;
  trailingDigits?: string;
}

export interface MailDossier {
  email: string;
  localPart: string;
  domain: string;
  disposable: boolean;
  roleBased: boolean;
  plusAddress: boolean;
  providerGuess?: string;
  mx: { priority: number; exchange: string }[];
  hasMx: boolean;
  gravatar?: {
    exists: boolean;
    hash: string;
    sha256?: string;
    profileUrl?: string;
    displayName?: string;
    avatarUrl?: string;
    accounts?: { shortname: string; url: string }[];
  };
  tenant?: {
    namespace?: string;
    federationBrand?: string;
    cloud?: string;
    domainName?: string;
  };
  domainSpf: SpfRecord[];
  domainDmarc: DmarcRecord[];
  dkim: DkimSelector[];
  bimi?: { present: boolean; raw?: string };
  domainCreated?: string;
  pivots: string[];
  localPartAnalysis: LocalPartAnalysis;
  openLinks: { label: string; url: string }[];
  hibp?: HibpDossier;
  /** Public AI-chat OSINT: account signals + readable share URLs. Never private transcripts. */
  aiChats?: AiChatDossier;
}

export interface AiPublicShare {
  product: string;
  url: string;
  readable: boolean;
  title?: string;
}

export interface AiChatDossier {
  disclaimer: string;
  searchLinks: { label: string; url: string }[];
  publicShares: AiPublicShare[];
}

export interface HibpBreach {
  name: string;
  title?: string;
  domain?: string;
  breachDate?: string;
  pwnCount?: number;
  dataClasses?: string[];
}

export interface HibpDossier {
  enabled: boolean;
  skipped?: string;
  breachCount: number;
  breaches: HibpBreach[];
  /** Public paste / stealer pivot URLs (no paid scraping). */
  pasteLinks?: { label: string; url: string }[];
}

export interface SpfRecord {
  raw: string;
  mechanisms: string[];
  allQualifier?: string;
}

export interface DmarcRecord {
  raw: string;
  policy?: string;
  rua?: string;
  ruf?: string;
  pct?: string;
}

export interface HostDossier {
  domain: string;
  rdap?: {
    handle?: string;
    registrar?: string;
    created?: string;
    expires?: string;
    updated?: string;
    nameservers: string[];
    status: string[];
    registrantCountry?: string;
    rdapUrl?: string;
    dnssec?: boolean;
    abuseEmail?: string;
  };
  dns: {
    a: string[];
    aaaa: string[];
    mx: { priority: number; exchange: string }[];
    ns: string[];
    txt: string[];
    cname: string[];
    soa?: string;
    caa: string[];
  };
  spf: SpfRecord[];
  dmarc: DmarcRecord[];
  securityTxt?: {
    found: boolean;
    url?: string;
    excerpt?: string;
    contact?: string[];
    expires?: string;
    encryption?: string[];
    policy?: string[];
    canonical?: string;
    preferredLanguages?: string;
  };
  https?: {
    ok: boolean;
    status?: number;
    title?: string;
    server?: string;
    hsts?: string;
    csp?: string;
    xPoweredBy?: string;
    xFrameOptions?: string;
    xContentTypeOptions?: string;
    referrerPolicy?: string;
    permissionsPolicy?: string;
    altSvc?: string;
    headers: Record<string, string>;
    finalUrl?: string;
  };
  cert?: {
    subject?: string;
    issuer?: string;
    san: string[];
    validFrom?: string;
    validTo?: string;
    daysRemaining?: number;
    serial?: string;
  };
  dkim: DkimSelector[];
  bimi?: { present: boolean; raw?: string };
}

export interface CrawlDossier {
  kind: "crawl";
  seed: string;
  origin: string;
  host: string;
  pages: number;
  skipped: number;
  blocked: number;
  emails: string[];
  usernames: string[];
  links: string[];
  headers: Record<string, string>;
  title?: string;
  maxPages: number;
  scope: "same-origin";
}

export interface PhoneDossier {
  raw: string;
  e164?: string;
  valid: boolean;
  possible: boolean;
  country?: string;
  countryCallingCode?: string;
  nationalNumber?: string;
  nationalFormat?: string;
  internationalFormat?: string;
  rfc3966?: string;
  type?: string;
  regionHint?: string;
  carrierHint?: string;
  timezones: string[];
  pivots: string[];
  lookups: { source: string; status: "found" | "miss" | "skipped" | "blocked" | "error"; detail?: string }[];
  openLinks: { label: string; url: string }[];
}

export interface GraphNode {
  id: string;
  kind: "handle" | "mail" | "host" | "phone" | "crawl" | "profile" | "avatar" | "oracle";
  label: string;
  status?: LedgerStatus;
  url?: string;
  pivot?: { query: string; mode: ScanMode };
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: string;
}

export interface IdentityGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AvatarClusterMember {
  site: string;
  url: string;
  avatarUrl: string;
}

export interface AvatarCluster {
  phash: string;
  sites: string[];
  avatarUrls: string[];
  distanceMax: number;
  members?: AvatarClusterMember[];
}

export interface ScanCompare {
  a: { id: string; query: string; mode: DetectedKind; found: number };
  b: { id: string; query: string; mode: DetectedKind; found: number };
  onlyA: { site: string; url: string; status: LedgerStatus }[];
  onlyB: { site: string; url: string; status: LedgerStatus }[];
  both: { site: string; urlA: string; urlB: string }[];
}

export interface ScanProgress {
  done: number;
  total: number;
  found: number;
  miss: number;
  blocked: number;
  escalate: number;
  error: number;
  invalid: number;
}

export interface ScanSummary {
  id: string;
  query: string;
  mode: DetectedKind;
  requestedMode: ScanMode;
  createdAt: string;
  finishedAt?: string;
  status: "running" | "done" | "cancelled";
  abortReason?: string;
  preflight: PreflightResult;
  progress: ScanProgress;
  dossier?: MailDossier | HostDossier | PhoneDossier | CrawlDossier;
  graph?: IdentityGraph;
  avatarClusters?: AvatarCluster[];
  includeNsfw: boolean;
  siteCount: number;
  profile?: "lean" | "full";
  profileNote?: string;
  source?: "user" | "watch" | "batch" | "auto-pivot";
  power?: boolean;
  autoPivots?: boolean;
  variants?: boolean;
  pivotDepth?: number;
  variantList?: string[];
  queuedPivots?: { query: string; mode: ScanMode; reason: string; profile?: "lean" | "full" }[];
}

export type ScanEvent =
  | { type: "hello"; scan: ScanSummary }
  | { type: "row"; row: LedgerRow }
  | { type: "rows"; rows: LedgerRow[] }
  | { type: "dossier"; dossier: MailDossier | HostDossier | PhoneDossier | CrawlDossier }
  | { type: "graph"; graph: IdentityGraph }
  | { type: "clusters"; clusters: AvatarCluster[] }
  | { type: "progress"; progress: ScanProgress }
  | { type: "notice"; message: string }
  | { type: "done"; scan: ScanSummary }
  | { type: "error"; message: string };

export interface SchemaStats {
  handleSites: number;
  categories: Record<string, number>;
  oracles: number;
  oraclesQuarantined?: number;
  disposableDomains: number;
  wmnImportedAt?: string;
  wmnSource?: string;
  wmnSites?: number;
  sherlockSites?: number;
  maigretSites?: number;
  curatedSites?: number;
  leanSites?: number;
  oraclesLean?: number;
}

export interface SavedCase {
  id: string;
  query: string;
  mode: DetectedKind;
  savedAt: string;
  found: number;
  summary: ScanSummary;
  foundRows: LedgerRow[];
  graph?: IdentityGraph;
}

export interface FoundSnapshot {
  site: string;
  url: string;
  status: LedgerStatus;
}

export interface WatchFindEvent {
  site: string;
  url: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface WatchRecord {
  id: string;
  query: string;
  mode: DetectedKind;
  intervalMs: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt: string;
  lastScanId?: string;
  lastFound: FoundSnapshot[];
  /** First time each found URL appeared across watch runs. */
  timeline?: WatchFindEvent[];
  enabled: boolean;
  lastError?: string;
}

export interface AlertChannelDelivery {
  webhook?: boolean;
  email?: boolean;
  telegram?: boolean;
}

export interface WatchAlert {
  id: string;
  watchId: string;
  query: string;
  mode: DetectedKind;
  createdAt: string;
  newFounds: FoundSnapshot[];
  goneFounds: FoundSnapshot[];
  read: boolean;
  webhookDelivered?: boolean;
  channelsDelivered?: AlertChannelDelivery;
}

export interface CaseShare {
  token: string;
  caseId: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  label?: string;
}

export interface SharedCaseView {
  readOnly: true;
  token: string;
  createdAt: string;
  expiresAt?: string;
  query: string;
  mode: DetectedKind;
  savedAt: string;
  found: number;
  dossier?: ScanSummary["dossier"];
  foundRows: LedgerRow[];
  graph?: IdentityGraph;
  avatarClusters?: AvatarCluster[];
  progress: ScanProgress;
  profile?: "lean" | "full";
}

export type BatchJobStatus = "queued" | "running" | "done" | "cancelled" | "skipped" | "error";

export interface BatchJob {
  id: string;
  query: string;
  raw: string;
  mode?: DetectedKind;
  status: BatchJobStatus;
  reason?: string;
  scanId?: string;
  found?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface BatchQueue {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "queued" | "running" | "done" | "cancelled";
  profile: "lean" | "full";
  jobs: BatchJob[];
  currentIndex: number;
}

export interface AlertChannelsPublic {
  webhook: boolean;
  email: boolean;
  smtp: boolean;
  resend: boolean;
  telegram: boolean;
}

export interface AlertChannelHint {
  configured: boolean;
  vars: string[];
  missing: string[];
}

export interface AlertSetupPublic {
  channels: AlertChannelsPublic;
  hints: {
    webhook: AlertChannelHint;
    telegram: AlertChannelHint;
    resend: AlertChannelHint;
    smtp: AlertChannelHint;
    emailTo: AlertChannelHint;
  };
  hibp: { configured: boolean; vars: string[] };
  note: string;
}

export interface AlertTestResult {
  ok: boolean;
  delivered: AlertChannelDelivery;
  configured: AlertChannelsPublic;
  message: string;
}
