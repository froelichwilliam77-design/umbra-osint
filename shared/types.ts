export type ScanMode = "auto" | "handle" | "mail" | "host" | "phone";
export type DetectedKind = "handle" | "mail" | "host" | "phone";

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
  | "nsfw";

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
}

export interface GraphNode {
  id: string;
  kind: "handle" | "mail" | "host" | "phone" | "profile" | "avatar" | "oracle";
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

export interface AvatarCluster {
  phash: string;
  sites: string[];
  avatarUrls: string[];
  distanceMax: number;
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
  dossier?: MailDossier | HostDossier | PhoneDossier;
  graph?: IdentityGraph;
  avatarClusters?: AvatarCluster[];
  includeNsfw: boolean;
  siteCount: number;
}

export type ScanEvent =
  | { type: "hello"; scan: ScanSummary }
  | { type: "row"; row: LedgerRow }
  | { type: "dossier"; dossier: MailDossier | HostDossier | PhoneDossier }
  | { type: "graph"; graph: IdentityGraph }
  | { type: "clusters"; clusters: AvatarCluster[] }
  | { type: "progress"; progress: ScanProgress }
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
  curatedSites?: number;
}
