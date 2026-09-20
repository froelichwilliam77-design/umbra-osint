import parsePhoneNumberFromString, { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import type { CountryCode } from "libphonenumber-js/max";
import type { LedgerRow, PhoneDossier } from "../shared/types.ts";
import { fetchPublic } from "./http.ts";

export const PHONE_LEDGER_COUNT = 5;

/** Public NANP NPA → region labels (numbering-plan data, not a live carrier dump). */
const NANP_NPA: Record<string, string> = {
  "201": "New Jersey",
  "202": "Washington DC",
  "203": "Connecticut",
  "205": "Alabama",
  "206": "Seattle, WA",
  "207": "Maine",
  "208": "Idaho",
  "209": "California (Central)",
  "210": "San Antonio, TX",
  "212": "New York City, NY",
  "213": "Los Angeles, CA",
  "214": "Dallas, TX",
  "215": "Philadelphia, PA",
  "216": "Cleveland, OH",
  "217": "Illinois",
  "218": "Minnesota",
  "219": "Indiana",
  "224": "Illinois",
  "225": "Louisiana",
  "228": "Mississippi",
  "229": "Georgia",
  "231": "Michigan",
  "234": "Ohio",
  "239": "Florida",
  "240": "Maryland",
  "248": "Michigan",
  "251": "Alabama",
  "252": "North Carolina",
  "253": "Tacoma, WA",
  "254": "Texas",
  "256": "Alabama",
  "260": "Indiana",
  "262": "Wisconsin",
  "267": "Philadelphia, PA",
  "269": "Michigan",
  "270": "Kentucky",
  "276": "Virginia",
  "281": "Houston, TX",
  "301": "Maryland",
  "302": "Delaware",
  "303": "Denver, CO",
  "304": "West Virginia",
  "305": "Miami, FL",
  "307": "Wyoming",
  "308": "Nebraska",
  "309": "Illinois",
  "310": "Los Angeles, CA",
  "312": "Chicago, IL",
  "313": "Detroit, MI",
  "314": "St. Louis, MO",
  "315": "New York",
  "316": "Kansas",
  "317": "Indianapolis, IN",
  "318": "Louisiana",
  "319": "Iowa",
  "320": "Minnesota",
  "321": "Florida",
  "323": "Los Angeles, CA",
  "325": "Texas",
  "330": "Ohio",
  "331": "Illinois",
  "334": "Alabama",
  "336": "North Carolina",
  "337": "Louisiana",
  "339": "Massachusetts",
  "346": "Houston, TX",
  "347": "New York City, NY",
  "351": "Massachusetts",
  "352": "Florida",
  "360": "Washington",
  "361": "Texas",
  "385": "Utah",
  "386": "Florida",
  "401": "Rhode Island",
  "402": "Nebraska",
  "404": "Atlanta, GA",
  "405": "Oklahoma",
  "406": "Montana",
  "407": "Orlando, FL",
  "408": "San Jose, CA",
  "409": "Texas",
  "410": "Baltimore, MD",
  "412": "Pittsburgh, PA",
  "413": "Massachusetts",
  "414": "Milwaukee, WI",
  "415": "San Francisco, CA",
  "417": "Missouri",
  "419": "Ohio",
  "423": "Tennessee",
  "424": "Los Angeles, CA",
  "425": "Washington",
  "430": "Texas",
  "432": "Texas",
  "434": "Virginia",
  "435": "Utah",
  "440": "Ohio",
  "442": "California",
  "443": "Maryland",
  "458": "Oregon",
  "469": "Dallas, TX",
  "470": "Atlanta, GA",
  "475": "Connecticut",
  "478": "Georgia",
  "479": "Arkansas",
  "480": "Arizona",
  "484": "Pennsylvania",
  "501": "Arkansas",
  "502": "Kentucky",
  "503": "Portland, OR",
  "504": "New Orleans, LA",
  "505": "New Mexico",
  "507": "Minnesota",
  "508": "Massachusetts",
  "509": "Washington",
  "510": "Oakland, CA",
  "512": "Austin, TX",
  "513": "Cincinnati, OH",
  "515": "Iowa",
  "516": "Long Island, NY",
  "517": "Michigan",
  "518": "New York",
  "520": "Arizona",
  "530": "California",
  "531": "Nebraska",
  "534": "Wisconsin",
  "539": "Oklahoma",
  "540": "Virginia",
  "541": "Oregon",
  "551": "New Jersey",
  "559": "California",
  "561": "Florida",
  "562": "California",
  "563": "Iowa",
  "567": "Ohio",
  "570": "Pennsylvania",
  "571": "Virginia",
  "573": "Missouri",
  "574": "Indiana",
  "575": "New Mexico",
  "580": "Oklahoma",
  "585": "Rochester, NY",
  "586": "Michigan",
  "601": "Mississippi",
  "602": "Phoenix, AZ",
  "603": "New Hampshire",
  "605": "South Dakota",
  "606": "Kentucky",
  "607": "New York",
  "608": "Wisconsin",
  "609": "New Jersey",
  "610": "Pennsylvania",
  "612": "Minneapolis, MN",
  "614": "Columbus, OH",
  "615": "Nashville, TN",
  "616": "Michigan",
  "617": "Boston, MA",
  "618": "Illinois",
  "619": "San Diego, CA",
  "620": "Kansas",
  "623": "Arizona",
  "626": "Pasadena, CA",
  "628": "San Francisco, CA",
  "629": "Tennessee",
  "630": "Illinois",
  "631": "Long Island, NY",
  "636": "Missouri",
  "641": "Iowa",
  "646": "New York City, NY",
  "650": "Peninsula, CA",
  "651": "Minnesota",
  "657": "California",
  "660": "Missouri",
  "661": "California",
  "662": "Mississippi",
  "667": "Maryland",
  "669": "San Jose, CA",
  "678": "Atlanta, GA",
  "681": "West Virginia",
  "682": "Texas",
  "701": "North Dakota",
  "702": "Las Vegas, NV",
  "703": "Northern Virginia",
  "704": "Charlotte, NC",
  "706": "Georgia",
  "707": "California",
  "708": "Illinois",
  "712": "Iowa",
  "713": "Houston, TX",
  "714": "Orange County, CA",
  "715": "Wisconsin",
  "716": "Buffalo, NY",
  "717": "Pennsylvania",
  "718": "New York City, NY",
  "719": "Colorado",
  "720": "Denver, CO",
  "724": "Pennsylvania",
  "725": "Las Vegas, NV",
  "727": "Florida",
  "731": "Tennessee",
  "732": "New Jersey",
  "734": "Michigan",
  "737": "Austin, TX",
  "740": "Ohio",
  "743": "North Carolina",
  "747": "Los Angeles, CA",
  "754": "Florida",
  "757": "Virginia",
  "760": "California",
  "762": "Georgia",
  "763": "Minnesota",
  "765": "Indiana",
  "769": "Mississippi",
  "770": "Georgia",
  "772": "Florida",
  "773": "Chicago, IL",
  "774": "Massachusetts",
  "775": "Nevada",
  "779": "Illinois",
  "781": "Massachusetts",
  "785": "Kansas",
  "786": "Miami, FL",
  "801": "Utah",
  "802": "Vermont",
  "803": "South Carolina",
  "804": "Richmond, VA",
  "805": "California",
  "806": "Texas",
  "808": "Hawaii",
  "810": "Michigan",
  "812": "Indiana",
  "813": "Tampa, FL",
  "814": "Pennsylvania",
  "815": "Illinois",
  "816": "Kansas City, MO",
  "817": "Fort Worth, TX",
  "818": "Los Angeles, CA",
  "828": "North Carolina",
  "830": "Texas",
  "831": "California",
  "832": "Houston, TX",
  "843": "South Carolina",
  "845": "New York",
  "847": "Illinois",
  "848": "New Jersey",
  "850": "Florida",
  "856": "New Jersey",
  "857": "Boston, MA",
  "858": "San Diego, CA",
  "859": "Kentucky",
  "860": "Connecticut",
  "862": "New Jersey",
  "863": "Florida",
  "864": "South Carolina",
  "865": "Tennessee",
  "870": "Arkansas",
  "872": "Chicago, IL",
  "878": "Pennsylvania",
  "901": "Memphis, TN",
  "903": "Texas",
  "904": "Jacksonville, FL",
  "906": "Michigan",
  "907": "Alaska",
  "908": "New Jersey",
  "909": "California",
  "910": "North Carolina",
  "912": "Georgia",
  "913": "Kansas",
  "914": "Westchester, NY",
  "915": "El Paso, TX",
  "916": "Sacramento, CA",
  "917": "New York City, NY",
  "918": "Oklahoma",
  "919": "Raleigh, NC",
  "920": "Wisconsin",
  "925": "California",
  "928": "Arizona",
  "929": "New York City, NY",
  "930": "Indiana",
  "931": "Tennessee",
  "934": "Long Island, NY",
  "936": "Texas",
  "937": "Ohio",
  "938": "Alabama",
  "940": "Texas",
  "941": "Florida",
  "947": "Michigan",
  "949": "Orange County, CA",
  "951": "California",
  "952": "Minnesota",
  "954": "Fort Lauderdale, FL",
  "956": "Texas",
  "959": "Connecticut",
  "970": "Colorado",
  "971": "Portland, OR",
  "972": "Dallas, TX",
  "973": "New Jersey",
  "978": "Massachusetts",
  "979": "Texas",
  "980": "Charlotte, NC",
  "984": "North Carolina",
  "985": "Louisiana",
  "989": "Michigan",
  "204": "Manitoba, Canada",
  "226": "Ontario, Canada",
  "236": "British Columbia, Canada",
  "249": "Ontario, Canada",
  "250": "British Columbia, Canada",
  "289": "Ontario, Canada",
  "306": "Saskatchewan, Canada",
  "343": "Ontario, Canada",
  "365": "Ontario, Canada",
  "403": "Alberta, Canada",
  "416": "Toronto, ON",
  "418": "Quebec, Canada",
  "437": "Toronto, ON",
  "438": "Montreal, QC",
  "450": "Quebec, Canada",
  "506": "New Brunswick, Canada",
  "514": "Montreal, QC",
  "519": "Ontario, Canada",
  "548": "Ontario, Canada",
  "579": "Quebec, Canada",
  "581": "Quebec, Canada",
  "587": "Alberta, Canada",
  "604": "Vancouver, BC",
  "613": "Ottawa, ON",
  "639": "Saskatchewan, Canada",
  "647": "Toronto, ON",
  "672": "British Columbia, Canada",
  "705": "Ontario, Canada",
  "709": "Newfoundland, Canada",
  "778": "British Columbia, Canada",
  "780": "Alberta, Canada",
  "782": "Nova Scotia, Canada",
  "807": "Ontario, Canada",
  "819": "Quebec, Canada",
  "825": "Alberta, Canada",
  "867": "Territories, Canada",
  "873": "Quebec, Canada",
  "879": "Newfoundland, Canada",
  "902": "Nova Scotia, Canada",
  "905": "Ontario, Canada",
  "242": "Bahamas",
  "246": "Barbados",
  "264": "Anguilla",
  "268": "Antigua",
  "284": "British Virgin Islands",
  "340": "US Virgin Islands",
  "345": "Cayman Islands",
  "441": "Bermuda",
  "473": "Grenada",
  "649": "Turks and Caicos",
  "664": "Montserrat",
  "670": "Northern Mariana Islands",
  "671": "Guam",
  "684": "American Samoa",
  "721": "Sint Maarten",
  "758": "Saint Lucia",
  "767": "Dominica",
  "784": "Saint Vincent",
  "787": "Puerto Rico",
  "809": "Dominican Republic",
  "829": "Dominican Republic",
  "849": "Dominican Republic",
  "868": "Trinidad and Tobago",
  "869": "Saint Kitts",
  "876": "Jamaica",
  "939": "Puerto Rico",
};

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  IN: "India",
  BR: "Brazil",
  JP: "Japan",
  MX: "Mexico",
  ES: "Spain",
  IT: "Italy",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  IE: "Ireland",
  NZ: "New Zealand",
  ZA: "South Africa",
  SG: "Singapore",
  AE: "United Arab Emirates",
  IL: "Israel",
  PL: "Poland",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  PT: "Portugal",
  DK: "Denmark",
  KR: "South Korea",
  CN: "China",
  RU: "Russia",
  TR: "Turkey",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  PH: "Philippines",
  ID: "Indonesia",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  NG: "Nigeria",
  EG: "Egypt",
  SA: "Saudi Arabia",
  PK: "Pakistan",
  BD: "Bangladesh",
  UA: "Ukraine",
  CZ: "Czechia",
  RO: "Romania",
  HU: "Hungary",
  GR: "Greece",
};

export function defaultPhoneRegion(): CountryCode {
  const raw = (process.env.UMBRA_PHONE_REGION ?? "US").trim().toUpperCase();
  const countries = getCountries();
  return (countries as string[]).includes(raw) ? (raw as CountryCode) : "US";
}

export function looksLikePhone(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  if (q.includes("@")) return false;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (q.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(q);
    return Boolean(parsed?.isPossible());
  }
  if (/[\s()./-]/.test(q) && digits.length >= 10) {
    const parsed = parsePhoneNumberFromString(q, defaultPhoneRegion());
    return Boolean(parsed?.isPossible());
  }
  if (/^\d{10,15}$/.test(q)) {
    const parsed = parsePhoneNumberFromString(q, defaultPhoneRegion());
    return Boolean(parsed?.isValid());
  }
  return false;
}

export function parsePhone(raw: string) {
  const q = raw.trim();
  return q.startsWith("+")
    ? parsePhoneNumberFromString(q)
    : parsePhoneNumberFromString(q, defaultPhoneRegion());
}

export function normalizePhone(raw: string): string {
  const parsed = parsePhone(raw);
  if (parsed?.number) return parsed.number;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : raw.trim();
}

function nanpHint(e164: string | undefined, country?: string): string | undefined {
  if (!e164) return undefined;
  const digits = e164.replace(/\D/g, "");
  if (country === "US" || country === "CA" || digits.startsWith("1")) {
    const npa = digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : digits.slice(0, 3);
    return NANP_NPA[npa];
  }
  return undefined;
}

function typeLabel(type?: string): string | undefined {
  if (!type) return undefined;
  return type.replaceAll("_", " ").toLowerCase();
}

export async function lookupTwilio(e164: string): Promise<PhoneDossier["lookups"][number] | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetchPublic({
    url,
    headers: { Authorization: `Basic ${auth}` },
    accept: "application/json",
  });
  if (res.status === 404) {
    return { source: "Twilio Lookup", status: "miss", detail: "Number not found in Twilio Lookup." };
  }
  if (res.status === 200) {
    try {
      const j = JSON.parse(res.body) as {
        line_type_intelligence?: { carrier_name?: string; type?: string };
        valid?: boolean;
      };
      const carrier = j.line_type_intelligence?.carrier_name;
      const kind = j.line_type_intelligence?.type;
      return {
        source: "Twilio Lookup",
        status: "found",
        detail: [carrier, kind].filter(Boolean).join(" · ") || "Lookup OK",
      };
    } catch {
      return { source: "Twilio Lookup", status: "found", detail: "Lookup OK" };
    }
  }
  if (res.status === 403 || res.status === 429) {
    return { source: "Twilio Lookup", status: "blocked", detail: `HTTP ${res.status}` };
  }
  return { source: "Twilio Lookup", status: "error", detail: `HTTP ${res.status}` };
}

export async function lookupNumverify(e164: string): Promise<PhoneDossier["lookups"][number] | null> {
  const key = process.env.NUMVERIFY_API_KEY?.trim();
  if (!key) return null;
  const url = `https://apilayer.net/api/validate?access_key=${encodeURIComponent(key)}&number=${encodeURIComponent(e164)}`;
  const res = await fetchPublic({ url, accept: "application/json" });
  if (res.status === 200) {
    try {
      const j = JSON.parse(res.body) as { valid?: boolean; carrier?: string; line_type?: string; location?: string };
      if (j.valid === false) return { source: "Numverify", status: "miss", detail: "Numverify marked invalid." };
      return {
        source: "Numverify",
        status: "found",
        detail: [j.carrier, j.line_type, j.location].filter(Boolean).join(" · ") || "valid",
      };
    } catch {
      return { source: "Numverify", status: "error", detail: "Non-JSON response" };
    }
  }
  if (res.status === 403 || res.status === 429) {
    return { source: "Numverify", status: "blocked", detail: `HTTP ${res.status}` };
  }
  return { source: "Numverify", status: "error", detail: `HTTP ${res.status}` };
}

export async function buildPhoneDossier(raw: string): Promise<PhoneDossier> {
  const parsed = parsePhone(raw);
  const e164 = parsed?.number;
  const country = parsed?.country;
  const type = parsed?.getType();
  const nanp = nanpHint(e164, country);
  const countryName = country ? COUNTRY_NAMES[country] ?? country : undefined;
  const regionHint = [countryName, nanp].filter(Boolean).join(" · ") || undefined;
  const typeHint = typeLabel(type);
  const lookups: PhoneDossier["lookups"] = [];
  if (e164) {
    const [twilio, numverify] = await Promise.all([lookupTwilio(e164), lookupNumverify(e164)]);
    if (twilio) lookups.push(twilio);
    if (numverify) lookups.push(numverify);
  }
  const carrierFromLookup = lookups.find((l) => l.status === "found" && l.detail)?.detail;
  const pivots: string[] = [];
  if (e164) pivots.push(e164);
  if (parsed?.nationalNumber) pivots.push(parsed.nationalNumber);
  if (country) pivots.push(country.toLowerCase());

  return {
    raw: raw.trim(),
    e164,
    valid: Boolean(parsed?.isValid()),
    possible: Boolean(parsed?.isPossible()),
    country,
    countryCallingCode: parsed?.countryCallingCode,
    nationalNumber: parsed?.nationalNumber,
    nationalFormat: parsed?.formatNational(),
    internationalFormat: parsed?.formatInternational(),
    rfc3966: parsed?.getURI(),
    type: typeHint,
    regionHint,
    carrierHint: carrierFromLookup || (typeHint ? `${typeHint} (libphonenumber type; live carrier needs Twilio/Numverify key)` : undefined),
    timezones: [],
    pivots: [...new Set(pivots)],
    lookups,
  };
}

export function preflightPhone(raw: string) {
  const parsed = parsePhone(raw);
  const notes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalized = parsed?.number ?? normalizePhone(raw);
  if (!parsed) errors.push("Could not parse a phone number (try E.164, e.g. +14155552671).");
  else if (!parsed.isPossible()) errors.push("Number is not a possible length for that country calling code.");
  else if (!parsed.isValid()) warnings.push("Length is possible but the number fails the checksum / range check.");
  if (parsed?.isValid()) {
    notes.push(`E.164 ${parsed.number}`);
    if (parsed.getType()) notes.push(`type ${typeLabel(parsed.getType())}`);
    if (parsed.country) notes.push(`country ${parsed.country}`);
  }
  notes.push("Public metadata only — Umbra never sends SMS.");
  return {
    ok: errors.length === 0,
    kind: "phone" as const,
    query: raw,
    normalized,
    notes,
    warnings,
    errors,
  };
}

export async function runPhoneScan(
  scanId: string,
  raw: string,
  opts: { onRow: (row: LedgerRow) => void; onDossier: (d: PhoneDossier) => void },
): Promise<void> {
  const dossier = await buildPhoneDossier(raw);
  opts.onDossier(dossier);
  const e164 = dossier.e164 ?? raw;
  opts.onRow({
    id: `${scanId}:e164`,
    scanId,
    mode: "phone",
    target: e164,
    site: "E.164",
    category: "phone",
    status: dossier.valid ? "found" : dossier.possible ? "escalate" : "invalid",
    reason: dossier.valid
      ? `${dossier.internationalFormat ?? e164} is a valid number.`
      : dossier.possible
        ? "Possible length, failed validity check."
        : "Not a valid phone number.",
    url: dossier.rfc3966 ?? e164,
    method: "PARSE",
    metadata: {
      displayName: dossier.internationalFormat,
      extra: {
        e164: dossier.e164 ?? "",
        country: dossier.country ?? "",
        type: dossier.type ?? "",
      },
    },
  });
  opts.onRow({
    id: `${scanId}:region`,
    scanId,
    mode: "phone",
    target: e164,
    site: "Region / type",
    category: "phone",
    status: dossier.regionHint || dossier.type ? "found" : "miss",
    reason: [dossier.regionHint, dossier.type, dossier.countryCallingCode ? `+${dossier.countryCallingCode}` : ""]
      .filter(Boolean)
      .join(" · ") || "No region hint.",
    url: e164,
    method: "LIBPHONENUMBER",
  });
  opts.onRow({
    id: `${scanId}:carrier`,
    scanId,
    mode: "phone",
    target: e164,
    site: "Carrier hint",
    category: "phone",
    status: dossier.lookups.some((l) => l.status === "found") ? "found" : "miss",
    reason: dossier.carrierHint ?? "No live carrier lookup (set TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN or NUMVERIFY_API_KEY).",
    url: e164,
    method: "LOOKUP",
  });
  for (const lookup of dossier.lookups) {
    opts.onRow({
      id: `${scanId}:lookup:${lookup.source}`,
      scanId,
      mode: "phone",
      target: e164,
      site: lookup.source,
      category: "phone",
      status: lookup.status === "skipped" ? "miss" : lookup.status,
      reason: lookup.detail ?? lookup.source,
      url: e164,
      method: "GET",
    });
  }
  if (dossier.lookups.length === 0) {
    opts.onRow({
      id: `${scanId}:public-links`,
      scanId,
      mode: "phone",
      target: e164,
      site: "Public search links",
      category: "phone",
      status: "found",
      reason: "Authorized public search URLs only — Umbra does not scrape paid walls or send SMS.",
      url: `https://duckduckgo.com/?q=${encodeURIComponent(`"${e164}"`)}`,
      method: "LINK",
      metadata: {
        extra: {
          duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(`"${e164}"`)}`,
          e164,
        },
      },
    });
  }
  void getCountryCallingCode;
}
