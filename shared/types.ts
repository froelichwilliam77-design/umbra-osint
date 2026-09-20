export type ScanMode = "auto" | "handle" | "mail" | "host";
export type DetectedKind = "handle" | "mail" | "host";

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

export interface LocalPartAnalysis {
  localPart: string;
  plusTag?: string;
  base: string;
  patterns: string[];
  possibleNames: string[];
  trailingYear?: string;
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
  pivots: string[];
  localPartAnalysis: LocalPartAnalysis;
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
    headers: Record<string, string>;
    finalUrl?: string;
  };
  cert?: {
    subject?: string;
    issuer?: string;
    san: string[];
    validFrom?: string;
    validTo?: string;
  };
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
  preflight: PreflightResult;
  progress: ScanProgress;
  dossier?: MailDossier | HostDossier;
  includeNsfw: boolean;
  siteCount: number;
}

export type ScanEvent =
  | { type: "hello"; scan: ScanSummary }
  | { type: "row"; row: LedgerRow }
  | { type: "dossier"; dossier: MailDossier | HostDossier }
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; scan: ScanSummary }
  | { type: "error"; message: string };

export interface SchemaStats {
  handleSites: number;
  categories: Record<string, number>;
  oracles: number;
  disposableDomains: number;
  wmnImportedAt?: string;
  wmnSource?: string;
}
