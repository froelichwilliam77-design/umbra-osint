import type { LedgerRow } from "../shared/types.ts";
import { type OracleVerdict } from "./oracles.ts";
import { fetchOracle, jsonStatus, pack, takenOrAvailable, wrapHttp } from "./mail-oracle-http.ts";
import {
  matchAsana,
  matchBinanceExist,
  matchCoinbaseExists,
  matchEpicEmailStatus,
  matchHudsonRock,
  matchLetterboxd,
  matchRobloxValidate,
  matchSteamEmail,
  matchTakenPhrases,
  matchWiseAvailability,
} from "./mail-oracle-match.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

function existsJson(
  j: unknown,
  foundKeys: string[],
  foundReason: string,
  missReason: string,
): OracleVerdict {
  const rec = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  const blob = JSON.stringify(j).toLowerCase();
  for (const key of foundKeys) {
    if (rec[key] === true) return { status: "found", reason: foundReason };
    if (rec[key] === false) return { status: "miss", reason: missReason };
  }
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
  for (const key of foundKeys) {
    if (nested[key] === true) return { status: "found", reason: foundReason };
    if (nested[key] === false) return { status: "miss", reason: missReason };
  }
  if (/already|taken|exists|registered/.test(blob) && !/not[_ ]exist|available/.test(blob)) {
    return { status: "found", reason: foundReason };
  }
  return { status: "escalate", reason: `${foundReason.replace(/\..*/, "")} inconclusive.` };
}

const handlers: Record<string, OracleFn> = {
  steam: async (email) => {
    const url = `https://store.steampowered.com/join/checkemail/?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Referer: "https://store.steampowered.com/join/" } });
    return jsonStatus(res, url, "GET", matchSteamEmail);
  },
  hudsonrock: async (email) => {
    const url = `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", matchHudsonRock);
  },
  asana: async (email) => {
    const url = `https://app.asana.com/-/email_exists?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://app.asana.com" },
      body: `email=${encodeURIComponent(email)}`,
    });
    if (res.status === 404) {
      const get = await fetchOracle({ url });
      return jsonStatus(get, url, "GET", matchAsana);
    }
    return jsonStatus(res, url, "POST", matchAsana);
  },
  letterboxd: async (email) => {
    const url = `https://letterboxd.com/user/check-email-address/?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Referer: "https://letterboxd.com/sign-up/" } });
    const v = matchLetterboxd(res.body);
    if (v) return pack(res, url, "GET", v);
    return wrapHttp(res, url, "GET");
  },
  reddit: async (email) => {
    const url = "https://www.reddit.com/api/check_email.json";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.reddit.com",
        Referer: "https://www.reddit.com/register/",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    const taken = matchTakenPhrases(res.body, ["EMAIL_TAKEN", "that email is already taken"]);
    if (taken) return pack(res, url, "POST", taken);
    if (res.status === 200 && (res.body.trim() === "{}" || res.body.includes('"errors":[]'))) {
      return pack(res, url, "POST", { status: "miss", reason: "Reddit check_email.json accepted the email." });
    }
    return wrapHttp(res, url, "POST");
  },
  airtable: async (email) => {
    const url = "https://airtable.com/auth/v0/lookup";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://airtable.com", Referer: "https://airtable.com/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "found"], "Airtable lookup resolved an account.", "Airtable lookup found no account."));
  },
  clickup: async (email) => {
    const url = "https://app.clickup.com/v1/checkEmail";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.clickup.com", Referer: "https://app.clickup.com/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "taken"], "ClickUp checkEmail exists=true.", "ClickUp checkEmail exists=false."));
  },
  calendly: async (email) => {
    const url = `https://calendly.com/api/booking/users/lookup?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Origin: "https://calendly.com" } });
    return jsonStatus(res, url, "GET", (j) => existsJson(j, ["exists", "registered", "found"], "Calendly lookup resolved a user.", "Calendly lookup found no user."));
  },
  etsy: async (email) => {
    const url = "https://www.etsy.com/api/v3/ajax/bespoke/member/nirvana/email-availability";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.etsy.com", Referer: "https://www.etsy.com/join" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { available?: boolean; email_available?: boolean };
      const available = rec.available ?? rec.email_available;
      if (available === false) return { status: "found", reason: "Etsy email-availability=false." };
      if (available === true) return { status: "miss", reason: "Etsy email-availability=true." };
      return existsJson(j, ["exists"], "Etsy email-availability reports taken.", "Etsy email-availability reports free.");
    });
  },
  tiktok: async (email) => {
    const url = `https://www.tiktok.com/passport/web/user/check_email_registered?aid=1459&email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Origin: "https://www.tiktok.com", Referer: "https://www.tiktok.com/signup" },
    });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { data?: { is_registered?: number | boolean }; message?: string };
      const flag = rec.data?.is_registered;
      if (flag === 1 || flag === true) return { status: "found", reason: "TikTok check_email_registered is_registered=1." };
      if (flag === 0 || flag === false) return { status: "miss", reason: "TikTok check_email_registered is_registered=0." };
      return existsJson(j, ["is_registered", "registered"], "TikTok reports registered.", "TikTok reports unregistered.");
    });
  },
  twitch: async (email) => {
    const url = `https://passport.twitch.tv/user/email_available?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Origin: "https://www.twitch.tv", Referer: "https://www.twitch.tv/signup" },
    });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { is_available?: boolean; available?: boolean };
      const available = rec.is_available ?? rec.available;
      if (available === false) return { status: "found", reason: "Twitch email_available=false." };
      if (available === true) return { status: "miss", reason: "Twitch email_available=true." };
      return { status: "escalate", reason: "Twitch email_available inconclusive." };
    });
  },
  gumroad: async (email) => {
    const url = "https://gumroad.com/signup";
    const res = await fetchOracle({
      url: "https://gumroad.com/users",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://gumroad.com",
        Referer: "https://gumroad.com/signup",
      },
      body: `user%5Bemail%5D=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["has already been taken", "already taken", "already in use"],
      available: ["can't be blank", "is too short", "password"],
      foundReason: "Gumroad users signup reports the email is taken.",
      missReason: "Gumroad users signup did not flag the email as taken.",
    });
  },
  kofi: async (email) => {
    const url = "https://ko-fi.com/account/checkemail";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://ko-fi.com", Referer: "https://ko-fi.com/account/register" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "taken"], "Ko-fi checkemail exists=true.", "Ko-fi checkemail exists=false."));
  },
  hashnode: async (email) => {
    const url = "https://hashnode.com/api/next/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://hashnode.com", Referer: "https://hashnode.com/onboard" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken"], "Hashnode check-email reports taken.", "Hashnode check-email reports available."));
  },
  substack: async (email) => {
    const url = "https://substack.com/api/v1/login";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://substack.com", Referer: "https://substack.com/sign-in" },
      body: JSON.stringify({ email, redirect: "/" }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("password") || body.includes("magic") || body.includes("exists")) {
      return pack(res, url, "POST", { status: "found", reason: "Substack login advanced past email (account exists)." });
    }
    if (body.includes("no account") || body.includes("not found") || body.includes("sign up")) {
      return pack(res, url, "POST", { status: "miss", reason: "Substack login found no account." });
    }
    return wrapHttp(res, url, "POST");
  },
  monday: async (email) => {
    const url = "https://auth.monday.com/users/sign_up_pre_validate";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://auth.monday.com", Referer: "https://auth.monday.com/users/sign_up" },
      body: JSON.stringify({ user: { email } }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken"], "Monday sign_up_pre_validate reports taken.", "Monday sign_up_pre_validate reports available."));
  },
  figma: async (email) => {
    const url = "https://www.figma.com/api/session/signup";
    const res = await fetchOracle({
      url: "https://www.figma.com/api/session/check_email",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.figma.com", Referer: "https://www.figma.com/signup" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.figma.com/api/session/check_email", "POST", (j) =>
      existsJson(j, ["exists", "taken", "registered"], "Figma check_email reports taken.", "Figma check_email reports available."),
    );
  },
  miro: async (email) => {
    const url = "https://miro.com/api/v1/accounts/email-availability";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://miro.com", Referer: "https://miro.com/signup/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { available?: boolean };
      if (rec.available === false) return { status: "found", reason: "Miro email-availability=false." };
      if (rec.available === true) return { status: "miss", reason: "Miro email-availability=true." };
      return existsJson(j, ["exists"], "Miro reports taken.", "Miro reports available.");
    });
  },
  sentry: async (email) => {
    const url = "https://sentry.io/api/0/auth/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://sentry.io", Referer: "https://sentry.io/auth/login/" },
      body: JSON.stringify({ username: email }),
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["password", "2fa", "mfa", "incorrect"],
      available: ["unable to login", "not found", "no account"],
      foundReason: "Sentry auth recognized the email (password/MFA step).",
      missReason: "Sentry auth did not recognize the email.",
    });
  },
  mailchimp: async (email) => {
    const url = "https://login.mailchimp.com/signup/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://login.mailchimp.com", Referer: "https://login.mailchimp.com/signup/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken"], "Mailchimp check-email reports taken.", "Mailchimp check-email reports available."));
  },
  zoom: async (email) => {
    const url = "https://zoom.us/signin/validate";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://zoom.us", Referer: "https://zoom.us/signin" },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exist", "exists", "registered"], "Zoom signin/validate exist=true.", "Zoom signin/validate exist=false."));
  },
  digitalocean: async (email) => {
    const url = "https://cloud.digitalocean.com/registrations";
    const res = await fetchOracle({
      url: "https://cloud.digitalocean.com/api/v1/registrations/validate_email",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://cloud.digitalocean.com", Referer: "https://cloud.digitalocean.com/registrations/new" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://cloud.digitalocean.com/api/v1/registrations/validate_email", "POST", (j) =>
      existsJson(j, ["taken", "exists"], "DigitalOcean validate_email reports taken.", "DigitalOcean validate_email reports available."),
    );
  },
  heroku: async (email) => {
    const url = "https://id.heroku.com/account/email/taken";
    const res = await fetchOracle({
      url: `${url}?email=${encodeURIComponent(email)}`,
      headers: { Origin: "https://id.heroku.com", Referer: "https://signup.heroku.com/" },
    });
    return jsonStatus(res, url, "GET", (j) => existsJson(j, ["taken", "exists"], "Heroku email/taken=true.", "Heroku email/taken=false."));
  },
  vercel: async (email) => {
    const url = "https://vercel.com/api/registration/email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://vercel.com", Referer: "https://vercel.com/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken", "registered"], "Vercel registration/email reports taken.", "Vercel registration/email reports available."));
  },
  huggingface: async (email) => {
    const url = `https://huggingface.co/api/validate-email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Referer: "https://huggingface.co/join" } });
    return jsonStatus(res, url, "GET", (j) => existsJson(j, ["exists", "taken", "registered"], "Hugging Face validate-email reports taken.", "Hugging Face validate-email reports available."));
  },
  roblox: async (email) => {
    const url = `https://auth.roblox.com/v2/users/validate?request.email=${encodeURIComponent(email)}&request.birthday=1990-01-01`;
    const res = await fetchOracle({ url, headers: { Origin: "https://www.roblox.com", Referer: "https://www.roblox.com/account/signupredir" } });
    return jsonStatus(res, url, "GET", matchRobloxValidate);
  },
  epicgames: async (email) => {
    const url = `https://www.epicgames.com/id/api/email/status?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url,
      headers: { Origin: "https://www.epicgames.com", Referer: "https://www.epicgames.com/id/register" },
    });
    return jsonStatus(res, url, "GET", matchEpicEmailStatus);
  },
  wix: async (email) => {
    const url = "https://users.wix.com/wix-smj-server/api/v1/user-email-exists";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://users.wix.com", Referer: "https://users.wix.com/signin" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "Wix user-email-exists=true.", "Wix user-email-exists=false."));
  },
  stripe: async (email) => {
    const url = `https://dashboard.stripe.com/ajax/validate/email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Referer: "https://dashboard.stripe.com/register" } });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { valid?: boolean; available?: boolean; exists?: boolean };
      if (rec.exists === true || rec.available === false) return { status: "found", reason: "Stripe validate/email reports taken." };
      if (rec.exists === false || rec.available === true || rec.valid === true) {
        return { status: "miss", reason: "Stripe validate/email reports available." };
      }
      return { status: "escalate", reason: "Stripe validate/email inconclusive." };
    });
  },
  coinbase: async (email) => {
    const url = `https://www.coinbase.com/api/v2/users/exists?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Origin: "https://www.coinbase.com", Referer: "https://www.coinbase.com/signup" } });
    return jsonStatus(res, url, "GET", matchCoinbaseExists);
  },
  binance: async (email) => {
    const url = "https://www.binance.com/bapi/accounts/v1/public/account/email/exist";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.binance.com", Referer: "https://www.binance.com/en/register" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", matchBinanceExist);
  },
  wise: async (email) => {
    const url = `https://wise.com/gateway/v1/email-availability?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Origin: "https://wise.com", Referer: "https://wise.com/register" } });
    return jsonStatus(res, url, "GET", matchWiseAvailability);
  },
  airbnb: async (email) => {
    const url = "https://www.airbnb.com/api/v2/auths/validate_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.airbnb.com", Referer: "https://www.airbnb.com/signup_login" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "valid"], "Airbnb validate_email reports registered.", "Airbnb validate_email reports unused."));
  },
  booking: async (email) => {
    const url = "https://account.booking.com/api/identity/login/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://account.booking.com", Referer: "https://account.booking.com/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "found"], "Booking check-email reports registered.", "Booking check-email reports unused."));
  },
  doordash: async (email) => {
    const url = "https://www.doordash.com/eats/v1/email/exists";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.doordash.com", Referer: "https://www.doordash.com/consumer/login/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "DoorDash email/exists=true.", "DoorDash email/exists=false."));
  },
  meetup: async (email) => {
    const url = "https://www.meetup.com/register/";
    const res = await fetchOracle({
      url: "https://www.meetup.com/gql2",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.meetup.com", Referer: "https://www.meetup.com/register/" },
      body: JSON.stringify({
        query: "query($email:String!){emailAvailable(email:$email)}",
        variables: { email },
      }),
    });
    void url;
    return jsonStatus(res, "https://www.meetup.com/gql2", "POST", (j) => {
      const rec = j as { data?: { emailAvailable?: boolean } };
      if (rec.data?.emailAvailable === false) return { status: "found", reason: "Meetup emailAvailable=false." };
      if (rec.data?.emailAvailable === true) return { status: "miss", reason: "Meetup emailAvailable=true." };
      return { status: "escalate", reason: "Meetup GraphQL emailAvailable inconclusive." };
    });
  },
  dailymotion: async (email) => {
    const url = "https://api.dailymotion.com/auth/info";
    const res = await fetchOracle({
      url: `https://api.dailymotion.com/auth?email=${encodeURIComponent(email)}`,
      headers: { Origin: "https://www.dailymotion.com" },
    });
    void url;
    return jsonStatus(res, `https://api.dailymotion.com/auth?email=`, "GET", (j) =>
      existsJson(j, ["exists", "registered"], "Dailymotion auth reports registered.", "Dailymotion auth reports unused."),
    );
  },
  yandex: async (email) => {
    const url = "https://passport.yandex.com/registration-validations/email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://passport.yandex.com",
        Referer: "https://passport.yandex.com/auth/reg",
      },
      body: `login=${encodeURIComponent(email)}&language=en`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["exists", "occupied", "taken", "already"],
      available: ["ok", "available", "free"],
      foundReason: "Yandex registration-validations/email reports occupied.",
      missReason: "Yandex registration-validations/email reports free.",
    });
  },
  vk: async (email) => {
    const url = "https://id.vk.com/join";
    const res = await fetchOracle({
      url: "https://api.vk.com/method/auth.validateAccount",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://id.vk.com" },
      body: `v=5.131&email=${encodeURIComponent(email)}`,
    });
    void url;
    return jsonStatus(res, "https://api.vk.com/method/auth.validateAccount", "POST", (j) => {
      const rec = j as { error?: { error_code?: number; error_msg?: string }; response?: { is_email_valid?: boolean } };
      const msg = String(rec.error?.error_msg ?? "");
      if (/already|occupied|registered|exists/i.test(msg) || rec.error?.error_code === 1004) {
        return { status: "found", reason: "VK auth.validateAccount reports the email is occupied." };
      }
      if (rec.response) return { status: "miss", reason: "VK auth.validateAccount accepted the email." };
      return { status: "escalate", reason: "VK auth.validateAccount inconclusive." };
    });
  },
  rumble: async (email) => {
    const url = "https://rumble.com/register.php";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://rumble.com",
        Referer: "https://rumble.com/register.php",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already in use", "already registered", "already taken"],
      available: ["username", "password", "required"],
      foundReason: "Rumble register.php reports the email is already in use.",
      missReason: "Rumble register.php did not flag the email.",
    });
  },
  medium: async (email) => {
    const url = "https://medium.com/_/api/users";
    const res = await fetchOracle({
      url: "https://medium.com/m/signin",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://medium.com", Referer: "https://medium.com/m/signin" },
      body: JSON.stringify({ email }),
    });
    void url;
    return takenOrAvailable(res, "https://medium.com/m/signin", "POST", {
      taken: ["password", "welcome back", "account exists"],
      available: ["create", "sign up", "register"],
      foundReason: "Medium signin recognized the email.",
      missReason: "Medium signin treated the email as new.",
    });
  },
  intercom: async (email) => {
    const url = "https://app.intercom.com/admins/sign_in";
    const res = await fetchOracle({
      url: "https://app.intercom.io/admins/check_email",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.intercom.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://app.intercom.io/admins/check_email", "POST", (j) =>
      existsJson(j, ["exists", "registered"], "Intercom check_email exists=true.", "Intercom check_email exists=false."),
    );
  },
  zendesk: async (email) => {
    const url = "https://www.zendesk.com/login/sso_check";
    const res = await fetchOracle({
      url: "https://www.zendesk.com/api/v2/users/me/identities",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.zendesk.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.zendesk.com/login/sso_check", "POST", (j) =>
      existsJson(j, ["exists", "found"], "Zendesk identity lookup resolved an account.", "Zendesk identity lookup found no account."),
    );
  },
  twilio: async (email) => {
    const url = "https://www.twilio.com/try-twilio";
    const res = await fetchOracle({
      url: "https://www.twilio.com/api/accounts/email-available",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.twilio.com", Referer: "https://www.twilio.com/try-twilio" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.twilio.com/api/accounts/email-available", "POST", (j) => {
      const rec = j as { available?: boolean };
      if (rec.available === false) return { status: "found", reason: "Twilio email-available=false." };
      if (rec.available === true) return { status: "miss", reason: "Twilio email-available=true." };
      return existsJson(j, ["exists"], "Twilio reports taken.", "Twilio reports available.");
    });
  },
  convertkit: async (email) => {
    const url = "https://app.convertkit.com/users/validate_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.convertkit.com", Referer: "https://app.convertkit.com/users/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["taken", "exists"], "ConvertKit validate_email reports taken.", "ConvertKit validate_email reports available."));
  },
  openai: async (email) => {
    const url = "https://auth.openai.com/api/accounts/exists";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://auth.openai.com", Referer: "https://auth.openai.com/create-account" },
      body: JSON.stringify({ username: email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "OpenAI accounts/exists=true.", "OpenAI accounts/exists=false."));
  },
  linear: async (email) => {
    const url = "https://linear.app/api/auth/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://linear.app", Referer: "https://linear.app/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "Linear check-email exists=true.", "Linear check-email exists=false."));
  },
  namecheap: async (email) => {
    const url = "https://www.namecheap.com/myaccount/signup/";
    const res = await fetchOracle({
      url: "https://www.namecheap.com/api/v1/ncpl/users/checkemail",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.namecheap.com", Referer: "https://www.namecheap.com/myaccount/signup/" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.namecheap.com/api/v1/ncpl/users/checkemail", "POST", (j) =>
      existsJson(j, ["exists", "taken"], "Namecheap checkemail reports taken.", "Namecheap checkemail reports available."),
    );
  },
  cloudflare: async (email) => {
    const url = "https://dash.cloudflare.com/api/v4/user/exists";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://dash.cloudflare.com", Referer: "https://dash.cloudflare.com/sign-up" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { result?: { exists?: boolean }; success?: boolean };
      if (rec.result?.exists === true) return { status: "found", reason: "Cloudflare user/exists result.exists=true." };
      if (rec.result?.exists === false) return { status: "miss", reason: "Cloudflare user/exists result.exists=false." };
      return existsJson(j, ["exists"], "Cloudflare reports taken.", "Cloudflare reports available.");
    });
  },
  mongodb: async (email) => {
    const url = "https://account.mongodb.com/account/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://account.mongodb.com", Referer: "https://account.mongodb.com/account/register" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken", "registered"], "MongoDB Atlas check-email reports taken.", "MongoDB Atlas check-email reports available."));
  },
  fastmail: async (email) => {
    const url = "https://www.fastmail.com/jmap/session";
    const res = await fetchOracle({
      url: "https://api.fastmail.com/signup/email-available",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.fastmail.com", Referer: "https://www.fastmail.com/signup/" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://api.fastmail.com/signup/email-available", "POST", (j) => {
      const rec = j as { available?: boolean };
      if (rec.available === false) return { status: "found", reason: "Fastmail email-available=false." };
      if (rec.available === true) return { status: "miss", reason: "Fastmail email-available=true." };
      return existsJson(j, ["exists"], "Fastmail reports taken.", "Fastmail reports available.");
    });
  },
  square: async (email) => {
    const url = "https://squareup.com/signup";
    const res = await fetchOracle({
      url: "https://squareup.com/api/v2/signup/email",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://squareup.com", Referer: "https://squareup.com/signup" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://squareup.com/api/v2/signup/email", "POST", (j) =>
      existsJson(j, ["exists", "taken"], "Square signup/email reports taken.", "Square signup/email reports available."),
    );
  },
  ancestry: async (email) => {
    const url = "https://www.ancestry.com/account/signin";
    const res = await fetchOracle({
      url: "https://www.ancestry.com/account/api/signin/identify",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.ancestry.com", Referer: "https://www.ancestry.com/account/signin" },
      body: JSON.stringify({ username: email }),
    });
    void url;
    return jsonStatus(res, "https://www.ancestry.com/account/api/signin/identify", "POST", (j) =>
      existsJson(j, ["exists", "found", "registered"], "Ancestry identify resolved an account.", "Ancestry identify found no account."),
    );
  },
  myheritage: async (email) => {
    const url = "https://www.myheritage.com/FP/API/signup.php";
    const res = await fetchOracle({
      url: `https://www.myheritage.com/FP/API/is-email-registered.php?email=${encodeURIComponent(email)}`,
      headers: { Referer: "https://www.myheritage.com/FP/signup.php" },
    });
    void url;
    const body = res.body.toLowerCase();
    if (body.includes("true") || body.includes("registered") || body.includes("1")) {
      if (body.includes("false") || body.includes("0")) {
        return pack(res, "https://www.myheritage.com/FP/API/is-email-registered.php", "GET", {
          status: "miss",
          reason: "MyHeritage is-email-registered reports unused.",
        });
      }
      return pack(res, "https://www.myheritage.com/FP/API/is-email-registered.php", "GET", {
        status: "found",
        reason: "MyHeritage is-email-registered reports registered.",
      });
    }
    if (body.includes("false") || body.trim() === "0") {
      return pack(res, "https://www.myheritage.com/FP/API/is-email-registered.php", "GET", {
        status: "miss",
        reason: "MyHeritage is-email-registered reports unused.",
      });
    }
    return wrapHttp(res, "https://www.myheritage.com/FP/API/is-email-registered.php", "GET");
  },
  pagerduty: async (email) => {
    const url = "https://identity.pagerduty.com/accounts/lookup";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://identity.pagerduty.com", Referer: "https://identity.pagerduty.com/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "found"], "PagerDuty accounts/lookup resolved an identity.", "PagerDuty accounts/lookup found no identity."));
  },
  datadog: async (email) => {
    const url = "https://app.datadoghq.com/account/login/id";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.datadoghq.com", Referer: "https://app.datadoghq.com/account/login" },
      body: JSON.stringify({ username: email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "Datadog login/id resolved an account.", "Datadog login/id found no account."));
  },
  freshdesk: async (email) => {
    const url = "https://freshdesk.com/signup";
    const res = await fetchOracle({
      url: "https://api.freshworks.com/signup/email_availability",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://freshdesk.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://api.freshworks.com/signup/email_availability", "POST", (j) => {
      const rec = j as { available?: boolean };
      if (rec.available === false) return { status: "found", reason: "Freshworks email_availability=false." };
      if (rec.available === true) return { status: "miss", reason: "Freshworks email_availability=true." };
      return existsJson(j, ["exists"], "Freshworks reports taken.", "Freshworks reports available.");
    });
  },
  sendgrid: async (email) => {
    const url = "https://signup.sendgrid.com/";
    const res = await fetchOracle({
      url: "https://api.sendgrid.com/v3/public/users/email",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://signup.sendgrid.com", Referer: "https://signup.sendgrid.com/" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://api.sendgrid.com/v3/public/users/email", "POST", (j) =>
      existsJson(j, ["exists", "taken"], "SendGrid users/email reports taken.", "SendGrid users/email reports available."),
    );
  },
  grafana: async (email) => {
    const url = `https://grafana.com/api/users/lookup?loginOrEmail=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, headers: { Referer: "https://grafana.com/" } });
    if (res.status === 404) {
      return pack(res, url, "GET", { status: "miss", reason: "Grafana users/lookup 404 — no account." });
    }
    if (res.status === 200) {
      return pack(res, url, "GET", { status: "found", reason: "Grafana users/lookup returned a profile." });
    }
    return wrapHttp(res, url, "GET");
  },
  newrelic: async (email) => {
    const url = "https://login.newrelic.com/login";
    const res = await fetchOracle({
      url: "https://login.newrelic.com/api/v1/users/exists",
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://login.newrelic.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://login.newrelic.com/api/v1/users/exists", "POST", (j) =>
      existsJson(j, ["exists", "registered"], "New Relic users/exists=true.", "New Relic users/exists=false."),
    );
  },
  godaddy: async (email) => {
    const url = "https://sso.godaddy.com/v1/api/idp/user/exists";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://sso.godaddy.com", Referer: "https://sso.godaddy.com/" },
      body: JSON.stringify({ username: email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "GoDaddy IdP user/exists=true.", "GoDaddy IdP user/exists=false."));
  },
  revolut: async (email) => {
    const url = "https://app.revolut.com/api/retail/signin/check";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.revolut.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered", "found"], "Revolut signin/check reports registered.", "Revolut signin/check reports unused."));
  },
  kraken: async (email) => {
    const url = "https://www.kraken.com/api/internal/account/check-email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.kraken.com", Referer: "https://www.kraken.com/sign-up" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "taken", "registered"], "Kraken check-email reports taken.", "Kraken check-email reports available."));
  },
  instacart: async (email) => {
    const url = "https://www.instacart.com/v3/dynamic_data/check_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.instacart.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => existsJson(j, ["exists", "registered"], "Instacart check_email exists=true.", "Instacart check_email exists=false."));
  },
  netflix: async (email) => {
    const url = "https://www.netflix.com/api/shakti/login/email";
    const res = await fetchOracle({
      url: "https://www.netflix.com/login",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.netflix.com",
        Referer: "https://www.netflix.com/login",
      },
      body: `userLoginId=${encodeURIComponent(email)}`,
    });
    void url;
    return takenOrAvailable(res, "https://www.netflix.com/login", "POST", {
      taken: ["incorrect password", "password is incorrect", "doesn't match"],
      available: ["we can't find", "could not find an account", "no account", "email not found"],
      foundReason: "Netflix login recognized the email (password error).",
      missReason: "Netflix login did not recognize the email.",
    });
  },
};

export { handlers as extHandlers };
