import type { LedgerRow } from "../shared/types.ts";
import { fetchFollow } from "./http.ts";
import { type OracleVerdict } from "./oracles.ts";
import {
  cookieHeader,
  csrfToken,
  fetchOracle,
  jsonStatus,
  pack,
  takenOrAvailable,
  wrapHttp,
} from "./mail-oracle-http.ts";
import {
  matchAmocrm,
  matchBlablacar,
  matchBodybuildingStatus,
  matchCoroflot,
  matchDiigo,
  matchDiscordRegister,
  matchEbayIdentifer,
  matchEllo,
  matchEvernote,
  matchFacebookAttempt,
  matchGarminValidate,
  matchInsightly,
  matchIssuu,
  matchLastpass,
  matchNimble,
  matchNocrm,
  matchPipedrive,
  matchRambler,
  matchRocketreach,
  matchSamsungSignup,
  matchSnapMerlin,
  matchTaringa,
  matchTeamleader,
  matchTellonym,
  matchTakenPhrases,
  matchVivino,
  matchVoxmedia,
  matchVrbo,
  matchVsco,
  matchWattpad,
} from "./mail-oracle-match.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

function rand(n: number): string {
  const a = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

const handlers: Record<string, OracleFn> = {
  voxmedia: async (email) => {
    const url = "https://auth.voxmedia.com/chorus_auth/email_valid.json";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://auth.voxmedia.com",
        Referer: "https://auth.voxmedia.com/login",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", matchVoxmedia);
  },
  amocrm: async (email) => {
    const url = "https://www.amocrm.com/account/check_login.php";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.amocrm.com",
        Referer: "https://www.amocrm.com/",
      },
      body: `LOGIN=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", matchAmocrm);
  },
  axonaut: async (email) => {
    const url = `https://axonaut.com/onboarding/?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "text/html" });
    const loc = (res.location ?? res.finalUrl ?? "").toLowerCase();
    if ((res.status === 302 || res.status === 301) && loc.includes("/login")) {
      return pack(res, url, "GET", { status: "found", reason: "Axonaut onboarding redirected to /login?email." });
    }
    if (res.status === 200) {
      return pack(res, url, "GET", { status: "miss", reason: "Axonaut onboarding stayed on signup (HTTP 200)." });
    }
    return wrapHttp(res, url, "GET");
  },
  insightly: async (email) => {
    const url = "https://accounts.insightly.com/signup/isemailvalid";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://accounts.insightly.com",
        Referer: "https://accounts.insightly.com/?plan=trial",
      },
      body: `emailaddress=${encodeURIComponent(email)}`,
    });
    const v = matchInsightly(res.body);
    if (v) return pack(res, url, "POST", v);
    return wrapHttp(res, url, "POST");
  },
  nimble: async (email) => {
    const url = `https://www.nimble.com/lib/register.php?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url });
    const v = matchNimble(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  nocrm: async (email) => {
    const url = `https://register.nocrm.io/register/check_trial_duplicate?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url });
    const v = matchNocrm(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  nutshell: async (email) => {
    const url = "https://app.nutshell.com/auth";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://app.nutshell.com",
        Referer: "https://app.nutshell.com/auth",
      },
      body: `via=database&timezone_offset=1&remember_me=true&username=${encodeURIComponent(email)}&invalidToken=false&password=a`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["sorry, your password is incorrect", "incorrect password", "wrong password"],
      available: ["find a nutshell account", "no account", "didn't find", "did not find"],
      foundReason: "Nutshell auth prompted for a password (account exists).",
      missReason: "Nutshell auth did not find an account for that email.",
    });
  },
  pipedrive: async (email) => {
    const url = "https://app.pipedrive.com/signup-service/start";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.pipedrive.com",
        Referer: "https://www.pipedrive.com/",
      },
      body: JSON.stringify({ email, language: "en", country_code: "us", selectedTier: null, packages: [] }),
    });
    return jsonStatus(res, url, "POST", matchPipedrive);
  },
  teamleader: async (email) => {
    const url = "https://focus.teamleader.eu/app/emails/availability";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://signup.focus.teamleader.fr",
        Referer: "https://signup.focus.teamleader.fr/",
      },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", matchTeamleader);
  },
  coroflot: async (email) => {
    const url = "https://www.coroflot.com/home/signup_email_check";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.coroflot.com",
        Referer: "https://www.coroflot.com/signup",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", matchCoroflot);
  },
  diigo: async (email) => {
    const url = `https://www.diigo.com/user_mana2/check_email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Referer: "https://www.diigo.com/sign-up?plan=free" },
    });
    const v = matchDiigo(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  rambler: async (email) => {
    const url = "https://id.rambler.ru/jsonrpc";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://id.rambler.ru",
        Referer: "https://id.rambler.ru/champ/registration",
      },
      body: JSON.stringify({ method: "Rambler::Id::get_email_account_info", params: [{ email }], rpc: "2.0" }),
    });
    return jsonStatus(res, url, "POST", matchRambler);
  },
  sporcle: async (email) => {
    const url = "https://www.sporcle.com/auth/ajax/verify.php";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.sporcle.com",
        Referer: "https://www.sporcle.com/",
      },
      body: `email=${encodeURIComponent(email)}&password1=&password2=&handle=&humancheck=&reg_path=main_header_join&ref_page=&querystring=`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["account already exists with this email"],
      available: ["ok", "valid", "success"],
      foundReason: "Sporcle verify.php reports an account already exists.",
      missReason: "Sporcle verify.php did not flag the email as taken.",
    });
  },
  ello: async (email) => {
    const url = "https://ello.co/api/v2/availability";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://ello.co", Referer: "https://ello.co/join" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", matchEllo);
  },
  rocketreach: async (email) => {
    const page = await fetchOracle({ url: "https://rocketreach.co/signup", accept: "text/html" });
    const token = csrfToken(page.body);
    const url = `https://rocketreach.co/v1/validateEmail?email_address=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: {
        ...(token ? { "x-csrftoken": token, Cookie: cookieHeader(page) } : {}),
        Referer: "https://rocketreach.co/signup",
        Origin: "https://rocketreach.co",
      },
    });
    return jsonStatus(res, url, "GET", matchRocketreach);
  },
  samsung: async (email) => {
    const signup = await fetchOracle({
      url: "https://account.samsung.com/accounts/v1/Samsung_com_US/signUp",
      accept: "text/html",
    });
    const csrf =
      signup.body.match(/['"]token['"]\s*:\s*['"]([^'"]+)/)?.[1] ??
      signup.body.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)/i)?.[1];
    const cookie = cookieHeader(signup);
    const url = "https://account.samsung.com/accounts/v1/Samsung_com_US/signUpCheckEmailIDProc";
    const res = await fetchOracle({
      url: `${url}?v=${Date.now() % 9999}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Origin: "https://account.samsung.com",
        Referer: "https://account.samsung.com/accounts/v1/Samsung_com_US/signUp",
        ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ emailID: email }),
    });
    return jsonStatus(res, url, "POST", matchSamsungSignup);
  },
  codepen: async (email) => {
    const page = await fetchOracle({ url: "https://codepen.io/accounts/signup/user/free", accept: "text/html" });
    const token = csrfToken(page.body);
    const url = "https://codepen.io/accounts/duplicate_check";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://codepen.io",
        Referer: "https://codepen.io/accounts/signup/user/free",
        ...(token ? { "X-CSRF-Token": token } : {}),
        ...(cookieHeader(page) ? { Cookie: cookieHeader(page) } : {}),
      },
      body: `attribute=email&value=${encodeURIComponent(email)}&context=user`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["that email is already taken", "already taken", "already in use"],
      available: ["ok", "available", "true"],
      foundReason: "CodePen duplicate_check reports the email is taken.",
      missReason: "CodePen duplicate_check did not flag the email.",
    });
  },
  devrant: async (email) => {
    const url = "https://devrant.com/api/users";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://devrant.com",
        Referer: "https://devrant.com/feed/top/month?login=1",
      },
      body: `app=3&type=1&email=${encodeURIComponent(email)}&username=&password=&guid=&plat=3&sid=&seid=`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already registered", "already in use", "already taken"],
      available: ["username", "required", "invalid"],
      foundReason: "devRant /api/users reports the email is already registered.",
      missReason: "devRant /api/users did not flag the email as registered.",
    });
  },
  teamtreehouse: async (email) => {
    const page = await fetchOracle({
      url: "https://teamtreehouse.com/subscribe/new?trial=yes",
      accept: "text/html",
    });
    const token = csrfToken(page.body);
    const url = "https://teamtreehouse.com/account/email_address";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://teamtreehouse.com",
        Referer: "https://teamtreehouse.com/subscribe/new?trial=yes",
        ...(token ? { "X-CSRF-Token": token } : {}),
        ...(cookieHeader(page) ? { Cookie: cookieHeader(page) } : {}),
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["that email address is taken", "already taken", "already in use"],
      available: ['"success":true', "success"],
      foundReason: "Treehouse account/email_address reports taken.",
      missReason: "Treehouse account/email_address accepted the email.",
    });
  },
  vrbo: async (email) => {
    const url = "https://www.vrbo.com/auth/aam/v3/status";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-homeaway-site": "vrbo",
        Origin: "https://www.vrbo.com",
        Referer: "https://www.vrbo.com/",
      },
      body: JSON.stringify({ emailAddress: email }),
    });
    return jsonStatus(res, url, "POST", matchVrbo);
  },
  ebay: async (email) => {
    const page = await fetchOracle({ url: "https://www.ebay.com/signin/", accept: "text/html" });
    const srt =
      page.body.split('"csrfAjaxToken":"')[1]?.split('"')[0] ??
      csrfToken(page.body);
    const url = "https://signin.ebay.com/signin/srv/identifer";
    if (!srt) return wrapHttp(page, url, "POST");
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.ebay.com",
        Referer: "https://www.ebay.com/signin/",
        Cookie: cookieHeader(page),
      },
      body: `identifier=${encodeURIComponent(email)}&srt=${encodeURIComponent(srt)}`,
    });
    return jsonStatus(res, url, "POST", matchEbayIdentifer);
  },
  garmin: async (email) => {
    const create =
      "https://sso.garmin.com/sso/createNewAccount?clientId=ACCOUNT_MANAGEMENT_CENTER&locale=en&gauthHost=https://sso.garmin.com/sso&id=js__app__create__gauth-widget&createAccountShown=true&openCreateAccount=true";
    const page = await fetchOracle({ url: create, accept: "text/html" });
    const token = page.body.split('"token": "')[1]?.split('"')[0] ?? page.body.split('"token":"')[1]?.split('"')[0];
    const url = "https://sso.garmin.com/sso/validateNewAccount";
    if (!token) return wrapHttp(page, url, "POST");
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://sso.garmin.com",
        Referer: "https://sso.garmin.com/sso/createNewAccount",
        Cookie: cookieHeader(page),
      },
      body: `email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
    });
    const v = matchGarminValidate(res.body);
    if (v) return pack(res, url, "POST", v);
    return wrapHttp(res, url, "POST");
  },
  vivino: async (email) => {
    const url = "https://www.vivino.com/api/login";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.vivino.com",
        Referer: "https://www.vivino.com/",
      },
      body: JSON.stringify({ email, password: "e" }),
    });
    return jsonStatus(res, url, "POST", matchVivino);
  },
  discord: async (email) => {
    const url = "https://discord.com/api/v9/auth/register";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://discord.com", Referer: "https://discord.com/register" },
      body: JSON.stringify({
        fingerprint: "",
        email,
        username: rand(16),
        password: `${rand(10)}A1!`,
        invite: null,
        consent: true,
        date_of_birth: "1990-01-01",
        gift_code_sku_id: null,
        captcha_key: null,
      }),
    });
    return jsonStatus(res, url, "POST", matchDiscordRegister);
  },
  facebook: async (email) => {
    const page = await fetchOracle({ url: "https://www.facebook.com/r.php", accept: "text/html" });
    const token =
      page.body.split('{"config":{"csrf_token":"')[1]?.split('"')[0] ?? csrfToken(page.body) ?? "missing";
    const url = "https://www.facebook.com/api/v1/web/accounts/web_create_ajax/attempt/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.facebook.com",
        Referer: "https://www.facebook.com/r.php",
        "x-csrftoken": token,
        Cookie: cookieHeader(page),
      },
      body: `email=${encodeURIComponent(email)}&username=${rand(12)}&first_name=&opt_into_one_tap=false`,
    });
    return jsonStatus(res, url, "POST", matchFacebookAttempt);
  },
  fanpop: async (email) => {
    const url = "https://www.fanpop.com/login/superlogin";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.fanpop.com",
        Referer: "https://www.fanpop.com/register",
      },
      body: `type=register&user%5Bname%5D=&user%5Bpassword%5D=&user%5Bemail%5D=${encodeURIComponent(email)}&agreement=&PersistentCookie=PersistentCookie&redirect_url=https%3A%2F%2Fwww.fanpop.com%2F&submissiontype=register`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already registered", "already in use"],
      available: ["register", "password", "username"],
      foundReason: "Fanpop superlogin reports the email is already registered.",
      missReason: "Fanpop superlogin did not flag the email as registered.",
    });
  },
  snapchat: async (email) => snapMerlin(email, "snapchat"),
  bitmoji: async (email) => snapMerlin(email, "bitmoji"),
  taringa: async (email) => {
    const url = "https://www.taringa.net/api/auth/availability/email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Origin: "https://www.taringa.net" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", matchTaringa);
  },
  tellonym: async (email) => {
    const url = `https://api.tellonym.me/accounts/check?email=${encodeURIComponent(email)}&errorMessage=&limit=25`;
    const res = await fetchOracle({
      url,
      headers: {
        "tellonym-client": "web:0.51.1",
        Origin: "https://tellonym.me",
        Referer: "https://tellonym.me/register/email",
      },
    });
    const v = matchTellonym(res.body);
    if (v) return pack(res, url, "GET", v);
    const taken = matchTakenPhrases(res.body);
    if (taken) return pack(res, url, "GET", taken);
    if (res.status === 200) {
      return pack(res, url, "GET", { status: "miss", reason: "Tellonym accounts/check did not return EMAIL_ALREADY_IN_USE." });
    }
    return wrapHttp(res, url, "GET");
  },
  vsco: async (email) => {
    const url = `https://api.vsco.co/2.0/users/email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Authorization: "Bearer 7356455548d0a1d886db010883388d08be84d0c9" },
    });
    return jsonStatus(res, url, "GET", matchVsco);
  },
  wattpad: async (email) => {
    const url = `https://www.wattpad.com/api/v3/users/validate?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Referer: "https://www.wattpad.com/", "X-Requested-With": "XMLHttpRequest" },
    });
    const v = matchWattpad(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  issuu: async (email) => {
    const url = `https://issuu.com/call/signup/check-email/${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Referer: "https://issuu.com/signup", "Content-Type": "application/json" },
    });
    return jsonStatus(res, url, "GET", matchIssuu);
  },
  lastpass: async (email) => {
    const url = `https://lastpass.com/create_account.php?check=avail&skipcontent=1&mistype=1&username=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "*/*", headers: { Referer: "https://lastpass.com/" } });
    const v = matchLastpass(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  bodybuilding: async (email) => {
    const url = `https://api.bodybuilding.com/profile/email/${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      method: "HEAD",
      headers: { Origin: "https://www.bodybuilding.com", Referer: "https://www.bodybuilding.com/" },
    });
    const v = matchBodybuildingStatus(res.status);
    if (v) return pack(res, url, "HEAD", v);
    return wrapHttp(res, url, "HEAD");
  },
  blablacar: async (email) => {
    const page = await fetchOracle({ url: "https://www.blablacar.com/register", accept: "text/html" });
    const appToken = page.body.split('"appToken":"')[1]?.split('"')[0];
    const url = `https://edge.blablacar.com/auth/validation/email/${encodeURIComponent(email)}`;
    if (!appToken) return wrapHttp(page, url, "GET");
    const res = await fetchOracle({
      url,
      headers: {
        Authorization: `Bearer ${appToken}`,
        "x-locale": "en_US",
        "x-client": "SPA|1.0.0",
        Origin: "https://www.blablacar.com",
        Referer: "https://www.blablacar.com/register",
      },
    });
    return jsonStatus(res, url, "GET", matchBlablacar);
  },
  evernote: async (email) => {
    const page = await fetchOracle({ url: "https://www.evernote.com/Login.action", accept: "text/html" });
    const hpts = page.body.split('document.getElementById("hpts").value = "')[1]?.split('"')[0];
    const hptsh = page.body.split('document.getElementById("hptsh").value = "')[1]?.split('"')[0];
    const source = page.body.split('<input type="hidden" name="_sourcePage" value="')[1]?.split('"')[0];
    const fp = page.body.split('<input type="hidden" name="__fp" value="')[1]?.split('"')[0];
    const url = "https://www.evernote.com/Login.action";
    if (!hpts || !source) return wrapHttp(page, url, "POST");
    const body = new URLSearchParams({
      username: email,
      evaluateUsername: "",
      hpts,
      hptsh: hptsh ?? "",
      analyticsLoginOrigin: "login_action",
      clipperFlow: "false",
      showSwitchService: "true",
      usernameImmutable: "false",
      _sourcePage: source,
      __fp: fp ?? "",
    });
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.evernote.com",
        Referer: "https://www.evernote.com/Login.action",
        Cookie: cookieHeader(page),
      },
      body: body.toString(),
    });
    const v = matchEvernote(res.body);
    if (v) return pack(res, url, "POST", v);
    return wrapHttp(res, url, "POST");
  },
  myspace: async (email) => {
    const page = await fetchOracle({ url: "https://myspace.com/signup/email", accept: "text/html" });
    const hash = page.body.split('<input name="csrf" type="hidden" value="')[1]?.split('"')[0] ?? csrfToken(page.body);
    const url = "https://myspace.com/ajax/account/validateemail";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://myspace.com",
        Referer: "https://myspace.com/signup/email",
        ...(hash ? { Hash: hash } : {}),
        Cookie: cookieHeader(page),
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already used to create an account", "already in use", "already registered"],
      available: ["ok", "valid", "true"],
      foundReason: "Myspace validateemail reports the address was already used.",
      missReason: "Myspace validateemail did not flag the email.",
    });
  },
  crevado: async (email) => {
    const page = await fetchOracle({ url: "https://crevado.com", accept: "text/html" });
    const token = csrfToken(page.body);
    const url = "https://crevado.com/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://crevado.com",
        Referer: "https://crevado.com/",
        Cookie: cookieHeader(page),
      },
      body: `utf8=%E2%9C%93&authenticity_token=${encodeURIComponent(token ?? "")}&plan=basic&account%5Bfull_name%5D=&account%5Bemail%5D=${encodeURIComponent(email)}&account%5Bpassword%5D=&account%5Bdomain%5D=&account%5Bconfirm_madness%5D=&account%5Bterms_accepted%5D=1`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["has already been taken", "already been taken", "already in use"],
      available: ["can't be blank", "is too short", "is invalid"],
      foundReason: "Crevado signup reports account_email has already been taken.",
      missReason: "Crevado signup did not flag the email as taken.",
    });
  },
  caringbridge: async (email) => {
    const url = "https://www.caringbridge.org/signin";
    const res = await fetchFollow({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.caringbridge.org",
        Referer: "https://www.caringbridge.org/signin",
      },
      body: `csrf=&email=${encodeURIComponent(email)}&password_placeholder=&submit-btn=Continue`,
      accept: "text/html",
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["welcome back"],
      available: ["create an account", "let's get started", "sign up"],
      foundReason: "CaringBridge signin rendered Welcome Back for this email.",
      missReason: "CaringBridge signin did not greet a returning user.",
    });
  },
  sevencups: async (email) => {
    const url = "https://www.7cups.com/listener/CreateAccount.php";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.7cups.com",
        Referer: "https://www.7cups.com/listener/CreateAccount.php",
      },
      body: `email=${encodeURIComponent(email)}&passwd=&dobMonth=12&dobDay=11&dobYear=1990`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["account already exists with this email address", "already exists"],
      available: ["success", "verify", "created"],
      foundReason: "7 Cups CreateAccount reports the email already exists.",
      missReason: "7 Cups CreateAccount did not flag the email as existing.",
    });
  },
  smule: async (email) => {
    const page = await fetchOracle({ url: "https://www.smule.com/user/check_email", accept: "text/html" });
    const token = csrfToken(page.body);
    const url = "https://www.smule.com/user/check_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.smule.com",
        Referer: "https://www.smule.com/",
        ...(token ? { "X-CSRF-Token": token } : {}),
        Cookie: cookieHeader(page),
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    try {
      const j = JSON.parse(res.body) as { email?: boolean | string };
      if (j.email === true || j.email === "True" || j.email === "true") {
        return pack(res, url, "POST", { status: "found", reason: "Smule check_email email=true (taken)." });
      }
      if (j.email === false || j.email === "False" || j.email === "false") {
        return pack(res, url, "POST", { status: "miss", reason: "Smule check_email email=false." });
      }
    } catch {
      /* fall through */
    }
    return wrapHttp(res, url, "POST");
  },
  tunefind: async (email) => {
    const url = "https://www.tunefind.com/user/join";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.tunefind.com",
        Referer: "https://www.tunefind.com/user/join",
        "x-tf-react": "true",
      },
      body: `username=&email=${encodeURIComponent(email)}&password=`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["someone is already registered with that email", "already registered", "already taken"],
      available: ["username", "password", "required"],
      foundReason: "Tunefind join reports the email is already registered.",
      missReason: "Tunefind join did not flag the email as registered.",
    });
  },
};

async function snapMerlin(email: string, app: "snapchat" | "bitmoji") {
  const page = await fetchOracle({ url: "https://accounts.snapchat.com", accept: "text/html" });
  const xsrf = page.body.split('data-xsrf="')[1]?.split('"')[0] ?? csrfToken(page.body);
  const webClientId = page.body.split('ata-web-client-id="')[1]?.split('"')[0] ?? "";
  const url = "https://accounts.snapchat.com/accounts/merlin/login";
  if (!xsrf) return wrapHttp(page, url, "POST");
  const res = await fetchOracle({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-XSRF-TOKEN": xsrf,
      Origin: "https://accounts.snapchat.com",
      Referer: "https://accounts.snapchat.com/",
      Cookie: `xsrf_token=${xsrf}; web_client_id=${webClientId}; ${cookieHeader(page)}`.trim(),
    },
    body: JSON.stringify({ email, app: app === "snapchat" ? "SNAPCHAT" : "BITMOJI_APP" }),
  });
  if (res.status === 204) {
    return pack(res, url, "POST", { status: "miss", reason: `Snap merlin HTTP 204 — no ${app} account.` });
  }
  return jsonStatus(res, url, "POST", (j) => matchSnapMerlin(j, app));
}

export { handlers as moreHandlers };
