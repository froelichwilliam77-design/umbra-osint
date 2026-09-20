import type { OracleVerdict } from "./oracles.ts";

function asRec(j: unknown): Record<string, unknown> {
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
}

function boolAt(rec: Record<string, unknown>, path: string[]): boolean | undefined {
  let cur: unknown = rec;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "boolean" ? cur : undefined;
}

/** Interpret a boolean existence flag. `trueMeansFound` when true = registered. */
export function flagVerdict(
  value: unknown,
  trueMeansFound: boolean,
  foundReason: string,
  missReason: string,
): OracleVerdict | null {
  if (typeof value !== "boolean") return null;
  const found = trueMeansFound ? value : !value;
  return found
    ? { status: "found", reason: foundReason }
    : { status: "miss", reason: missReason };
}

export function firstFlag(rec: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof rec[key] === "boolean") return rec[key] as boolean;
    const nested = key.includes(".") ? boolAt(rec, key.split(".")) : undefined;
    if (typeof nested === "boolean") return nested;
  }
  return undefined;
}

export function matchLastpass(body: string): OracleVerdict | null {
  const t = body.trim().toLowerCase();
  if (t === "no") return { status: "found", reason: "LastPass create_account check=avail returned no (taken)." };
  if (t === "ok" || t === "emailinvalid") {
    return { status: "miss", reason: "LastPass create_account reports available or invalid." };
  }
  return null;
}

export function matchIssuu(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.status === "unavailable") return { status: "found", reason: "Issuu check-email status=unavailable." };
  if (rec.status === "available" || rec.status === "ok") {
    return { status: "miss", reason: `Issuu check-email status=${String(rec.status)}.` };
  }
  return { status: "escalate", reason: `Issuu check-email inconclusive (${String(rec.status ?? "no status")}).` };
}

export function matchTeamleader(j: unknown): OracleVerdict {
  const available = firstFlag(asRec(j), ["available"]);
  return (
    flagVerdict(available, false, "Teamleader emails/availability=false (taken).", "Teamleader emails/availability=true.") ?? {
      status: "escalate",
      reason: "Teamleader availability flag missing.",
    }
  );
}

export function matchVoxmedia(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.available === true) return { status: "miss", reason: "Vox Media email_valid available=true." };
  if (String(rec.message ?? "").includes("You cannot use this email address")) {
    return { status: "miss", reason: "Vox Media rejected the address as unusable, not registered." };
  }
  if (rec.available === false) return { status: "found", reason: "Vox Media email_valid available=false." };
  return { status: "escalate", reason: "Vox Media email_valid inconclusive." };
}

export function matchAmocrm(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.status === "used") return { status: "found", reason: "amoCRM check_login status=used." };
  if (rec.status === "free") return { status: "miss", reason: "amoCRM check_login status=free." };
  return { status: "escalate", reason: `amoCRM check_login status=${String(rec.status ?? "missing")}.` };
}

export function matchNocrm(body: string): OracleVerdict | null {
  if (body.includes('"account":1') || /"account"\s*:\s*1/.test(body)) {
    return { status: "found", reason: "noCRM check_trial_duplicate account=1." };
  }
  if (body.includes('"account":0') || body.replace(/\s/g, "") === '{"account":0}') {
    return { status: "miss", reason: "noCRM check_trial_duplicate account=0." };
  }
  return null;
}

export function matchInsightly(body: string): OracleVerdict | null {
  const t = body.trim();
  if (/an account exists for this address/i.test(t)) {
    return { status: "found", reason: "Insightly signup reports an account exists for this address." };
  }
  if (t.toLowerCase() === "true") return { status: "miss", reason: "Insightly isemailvalid=true." };
  return null;
}

export function matchNimble(body: string): OracleVerdict | null {
  if (/already registered/i.test(body) || /looked familiar/i.test(body)) {
    return { status: "found", reason: "Nimble register.php reports the email is already registered." };
  }
  if (body.trim().toLowerCase() === "true") return { status: "miss", reason: "Nimble register.php=true (unused)." };
  return null;
}

export function matchPipedrive(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const errors = asRec(rec.errors);
  const emailErr = String(errors.user_email ?? errors.email ?? "");
  if (/not available|already|exists|taken/i.test(emailErr)) {
    return { status: "found", reason: "Pipedrive signup-service reports the email is not available." };
  }
  const data = asRec(rec.data);
  if (typeof data.redirectUrl === "string" && data.redirectUrl.includes("signup")) {
    return { status: "miss", reason: "Pipedrive signup-service allowed a new signup redirect." };
  }
  return { status: "escalate", reason: "Pipedrive signup-service inconclusive." };
}

export function matchCoroflot(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.data === -2 || rec.data === "-2") return { status: "found", reason: "Coroflot signup_email_check data=-2 (taken)." };
  if (rec.data === 1 || rec.data === 0 || rec.data === true || rec.data === "1") {
    return { status: "miss", reason: `Coroflot signup_email_check data=${String(rec.data)}.` };
  }
  return { status: "escalate", reason: "Coroflot signup_email_check inconclusive." };
}

export function matchDiigo(body: string): OracleVerdict | null {
  const t = body.trim();
  if (t === "0") return { status: "found", reason: "Diigo check_email returned 0 (taken)." };
  if (t === "1" || t === "ok" || t === "true") return { status: "miss", reason: "Diigo check_email reports unused." };
  return null;
}

export function matchRambler(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const result = asRec(rec.result);
  if (result.exists === 0 || result.exists === false) return { status: "miss", reason: "Rambler Id exists=0." };
  if (result.exists === 1 || result.exists === true || (typeof result.exists === "number" && result.exists > 0)) {
    return { status: "found", reason: "Rambler Id exists>0." };
  }
  return { status: "escalate", reason: "Rambler JSON-RPC inconclusive." };
}

export function matchEllo(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const avail = asRec(rec.availability);
  if (avail.email === true) return { status: "miss", reason: "Ello availability.email=true." };
  if (avail.email === false) return { status: "found", reason: "Ello availability.email=false (taken)." };
  return { status: "escalate", reason: "Ello availability inconclusive." };
}

export function matchRocketreach(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.found === true) return { status: "found", reason: "RocketReach validateEmail found=true." };
  if (rec.found === false) return { status: "miss", reason: "RocketReach validateEmail found=false." };
  return { status: "escalate", reason: "RocketReach validateEmail inconclusive." };
}

export function matchVrbo(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const types = rec.authType;
  const first = Array.isArray(types) ? String(types[0] ?? "") : String(types ?? rec.auth_type ?? "");
  if (/LOGIN/i.test(first)) return { status: "found", reason: `Vrbo auth status authType=${first}.` };
  if (/SIGNUP/i.test(first)) return { status: "miss", reason: `Vrbo auth status authType=${first}.` };
  return { status: "escalate", reason: "Vrbo auth status inconclusive." };
}

export function matchEbayIdentifer(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if ("err" in rec || rec.error || rec.errors) return { status: "miss", reason: "eBay identifier lookup returned err (no account)." };
  if (rec.success === true || rec.exists === true || rec.recognized === true || rec.next === "password") {
    return { status: "found", reason: "eBay identifier lookup resolved an account." };
  }
  if (Object.keys(rec).length === 0) return { status: "escalate", reason: "eBay identifier lookup empty JSON." };
  return { status: "found", reason: "eBay identifier lookup returned a profile payload (no err)." };
}

export function matchGarminValidate(body: string): OracleVerdict | null {
  const t = body.trim().toLowerCase();
  if (t === "false") return { status: "found", reason: "Garmin validateNewAccount=false (email taken)." };
  if (t === "true") return { status: "miss", reason: "Garmin validateNewAccount=true (available)." };
  return null;
}

export function matchVivino(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const err = String(rec.error ?? rec.message ?? "");
  if (/does not exist|not found|no account|unknown/i.test(err)) {
    return { status: "miss", reason: "Vivino login reports the email does not exist." };
  }
  if (rec.error || rec.user || rec.id || rec.access_token) {
    return { status: "found", reason: "Vivino login recognized the email (password step / user payload)." };
  }
  return { status: "escalate", reason: "Vivino login inconclusive." };
}

export function matchDiscordRegister(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const blob = JSON.stringify(j);
  if (/EMAIL_ALREADY_REGISTERED/i.test(blob)) {
    return { status: "found", reason: "Discord register errors.email=EMAIL_ALREADY_REGISTERED." };
  }
  if (Array.isArray(rec.captcha_key) || /captcha-required/i.test(blob)) {
    return { status: "blocked", reason: "Discord register requires CAPTCHA." };
  }
  if (rec.token || rec.user) return { status: "miss", reason: "Discord register did not flag the email as taken." };
  if (rec.code != null) return { status: "escalate", reason: `Discord register code=${String(rec.code)}.` };
  return { status: "escalate", reason: "Discord register inconclusive." };
}

export function matchTellonym(body: string): OracleVerdict | null {
  if (/EMAIL_ALREADY_IN_USE/i.test(body)) {
    return { status: "found", reason: "Tellonym accounts/check EMAIL_ALREADY_IN_USE." };
  }
  if (/"email"/i.test(body) && /valid/i.test(body) && !/ALREADY/i.test(body)) {
    return { status: "miss", reason: "Tellonym accounts/check did not flag the email." };
  }
  return null;
}

export function matchVsco(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.email_status === "has_account") return { status: "found", reason: "VSCO email_status=has_account." };
  if (rec.email_status === "no_account") return { status: "miss", reason: "VSCO email_status=no_account." };
  return { status: "escalate", reason: `VSCO email_status=${String(rec.email_status ?? "missing")}.` };
}

export function matchWattpad(body: string): OracleVerdict | null {
  if (/already|taken|cette adresse|is associated/i.test(body) && !/"code":200/.test(body)) {
    return { status: "found", reason: "Wattpad users/validate reports the email is taken." };
  }
  if (/"code"\s*:\s*200/.test(body) || body.includes('"message":"OK"') || body.trim() === "{}") {
    return { status: "miss", reason: "Wattpad users/validate accepted the email." };
  }
  return null;
}

export function matchTaringa(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.available === false) return { status: "found", reason: "Taringa email availability=false." };
  if (rec.available === true) return { status: "miss", reason: "Taringa email availability=true." };
  return { status: "escalate", reason: "Taringa availability inconclusive." };
}

export function matchSnapMerlin(j: unknown, app: "snapchat" | "bitmoji"): OracleVerdict {
  const rec = asRec(j);
  const key = app === "snapchat" ? "hasSnapchat" : "hasBitmoji";
  const flag = rec[key];
  if (flag === true) return { status: "found", reason: `Snap merlin ${key}=true.` };
  if (flag === false) return { status: "miss", reason: `Snap merlin ${key}=false.` };
  return { status: "escalate", reason: `Snap merlin missing ${key}.` };
}

export function matchSamsungSignup(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const blob = JSON.stringify(j);
  if (/INAPPROPRIATE_CHARACTERS|aren't supported|are not supported/i.test(blob)) {
    return { status: "miss", reason: "Samsung signUpCheckEmailIDProc rejected the address as unsupported." };
  }
  if (rec.rtnCd != null && rec.rtnCd !== "") {
    return { status: "found", reason: `Samsung signUpCheckEmailIDProc rtnCd=${String(rec.rtnCd)}.` };
  }
  if (rec.exists === true) return { status: "found", reason: "Samsung email check exists=true." };
  if (rec.exists === false) return { status: "miss", reason: "Samsung email check exists=false." };
  return { status: "escalate", reason: "Samsung signup email check inconclusive." };
}

export function matchSteamEmail(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.bAvailable === false) return { status: "found", reason: "Steam join/checkemail bAvailable=false." };
  if (rec.bAvailable === true) return { status: "miss", reason: "Steam join/checkemail bAvailable=true." };
  return { status: "escalate", reason: "Steam join/checkemail inconclusive." };
}

export function matchHudsonRock(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const stealers = Array.isArray(rec.stealers) ? rec.stealers : [];
  const employees = Array.isArray(rec.employees) ? rec.employees : Array.isArray(rec.data) ? rec.data : [];
  const total = typeof rec.total === "number" ? rec.total : stealers.length + employees.length;
  if (total > 0 || stealers.length > 0 || employees.length > 0) {
    return { status: "found", reason: `Hudson Rock cavalier returned ${total || stealers.length + employees.length} infostealer record(s).` };
  }
  if ("stealers" in rec || "employees" in rec || "total" in rec || rec.message) {
    return { status: "miss", reason: "Hudson Rock cavalier returned no infostealer records." };
  }
  return { status: "escalate", reason: "Hudson Rock cavalier inconclusive." };
}

export function matchAsana(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const exists = firstFlag(rec, ["email_exists", "exists", "user_exists"]);
  return (
    flagVerdict(exists, true, "Asana email_exists=true.", "Asana email_exists=false.") ?? {
      status: "escalate",
      reason: "Asana email_exists flag missing.",
    }
  );
}

export function matchLetterboxd(body: string): OracleVerdict | null {
  const t = body.trim().toLowerCase();
  if (t.includes("not-available") || t.includes("already") || t.includes("taken") || t === "false") {
    return { status: "found", reason: "Letterboxd email check reports taken." };
  }
  if (t.includes("available") || t === "true" || t === "ok") {
    return { status: "miss", reason: "Letterboxd email check reports available." };
  }
  return null;
}

export function matchBinanceExist(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const data = rec.data;
  if (data === true || rec.exist === true || rec.exists === true) {
    return { status: "found", reason: "Binance public email/exist=true." };
  }
  if (data === false || rec.exist === false || rec.exists === false) {
    return { status: "miss", reason: "Binance public email/exist=false." };
  }
  return { status: "escalate", reason: "Binance email/exist inconclusive." };
}

export function matchCoinbaseExists(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const data = asRec(rec.data);
  const exists = firstFlag(rec, ["exists", "registered"]) ?? firstFlag(data, ["exists", "registered"]);
  return (
    flagVerdict(exists, true, "Coinbase users/exists=true.", "Coinbase users/exists=false.") ?? {
      status: "escalate",
      reason: "Coinbase exists flag missing.",
    }
  );
}

export function matchWiseAvailability(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const available = firstFlag(rec, ["available", "isAvailable"]);
  return (
    flagVerdict(available, false, "Wise email-availability=false (taken).", "Wise email-availability=true.") ?? {
      status: "escalate",
      reason: "Wise email-availability flag missing.",
    }
  );
}

export function matchRobloxValidate(j: unknown): OracleVerdict {
  const rec = asRec(j);
  const code = String(rec.code ?? rec.errors ?? rec.message ?? "");
  const blob = JSON.stringify(j).toLowerCase();
  if (/already|taken|in use|exists/.test(blob)) return { status: "found", reason: "Roblox users/validate reports the email is taken." };
  if (rec.valid === true || rec.success === true) return { status: "miss", reason: "Roblox users/validate accepted the email." };
  if (rec.valid === false) return { status: "found", reason: `Roblox users/validate valid=false (${code}).` };
  return { status: "escalate", reason: "Roblox users/validate inconclusive." };
}

export function matchEpicEmailStatus(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if (rec.exists === true || rec.registered === true) return { status: "found", reason: "Epic Games email/status exists=true." };
  if (rec.exists === false || rec.registered === false) return { status: "miss", reason: "Epic Games email/status exists=false." };
  return { status: "escalate", reason: "Epic Games email/status inconclusive." };
}

export function matchBodybuildingStatus(status: number): OracleVerdict | null {
  if (status === 200) return { status: "found", reason: "Bodybuilding profile/email HEAD 200." };
  if (status === 404) return { status: "miss", reason: "Bodybuilding profile/email HEAD 404." };
  return null;
}

export function matchBlablacar(j: unknown): OracleVerdict {
  const rec = asRec(j);
  if ("url" in rec && typeof rec.url === "string") {
    return { status: "blocked", reason: "BlaBlaCar validation returned a challenge URL (bot/WAF)." };
  }
  if (typeof rec.exists === "boolean") {
    return rec.exists
      ? { status: "found", reason: "BlaBlaCar auth/validation/email exists=true." }
      : { status: "miss", reason: "BlaBlaCar auth/validation/email exists=false." };
  }
  return { status: "escalate", reason: "BlaBlaCar email validation inconclusive." };
}

export function matchEvernote(body: string): OracleVerdict | null {
  if (body.includes("usePasswordAuth")) return { status: "found", reason: "Evernote Login.action usePasswordAuth (account exists)." };
  if (body.includes("displayMessage") && /not found|no account|couldn't find|unknown/i.test(body)) {
    return { status: "miss", reason: "Evernote Login.action displayMessage without a password prompt." };
  }
  if (body.includes("displayMessage")) return { status: "miss", reason: "Evernote Login.action displayMessage (no password auth)." };
  return null;
}

export function matchFacebookAttempt(j: unknown): OracleVerdict {
  const blob = JSON.stringify(j);
  if (/email_is_taken|email_sharing_limit/i.test(blob)) {
    return { status: "found", reason: "Facebook web_create_ajax reports email_is_taken." };
  }
  const rec = asRec(j);
  if (rec.status === "fail") return { status: "blocked", reason: "Facebook web_create_ajax status=fail (likely CSRF/WAF)." };
  if (rec.errors && typeof rec.errors === "object" && !/email/i.test(blob)) {
    return { status: "miss", reason: "Facebook web_create_ajax had errors but not email_is_taken." };
  }
  return { status: "escalate", reason: "Facebook web_create_ajax inconclusive." };
}

export function matchTakenPhrases(body: string, extraTaken: string[] = []): OracleVerdict | null {
  const taken = [
    "already been taken",
    "already registered",
    "already in use",
    "already exists",
    "email is taken",
    "email already",
    "has already been taken",
    "is already associated",
    "account exists",
    "an account with this email",
    "someone is already registered",
    "that email is already",
    "email address is already",
    ...extraTaken,
  ];
  const lower = body.toLowerCase();
  if (taken.some((t) => lower.includes(t.toLowerCase()))) {
    return { status: "found", reason: "Signup/availability endpoint reports the email is taken." };
  }
  return null;
}
