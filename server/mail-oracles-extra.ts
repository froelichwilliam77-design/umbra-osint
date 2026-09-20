import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { fetchFollow, fetchPublic } from "./http.ts";
import { type OracleVerdict } from "./oracles.ts";
import { jsonStatus, wrapHttp } from "./mail-oracle-http.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

const handlers: Record<string, OracleFn> = {
  aboutme: async (email) => {
    const url = "https://about.me/n/app/signup";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password: "UmbraOracle!23", first_name: "U", last_name: "M" }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("already") || body.includes("taken") || res.status === 409) {
      return {
        verdict: { status: "found", reason: "about.me signup reports the email is in use." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  dockerhub: async (email) => {
    const url = "https://hub.docker.com/v2/users/signup/";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username: "umbra_oracle_check", password: "UmbraOracle!23" }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("already") || body.includes("exists")) {
      return {
        verdict: { status: "found", reason: "Docker Hub signup reports the email exists." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  notion: async (email) => {
    const url = "https://www.notion.so/api/v3/getSubscriptionData";
    const res = await fetchPublic({
      url: "https://www.notion.so/api/v3/lookupEmailOnboarding",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.notion.so/api/v3/lookupEmailOnboarding", "POST", (j) => {
      const rec = j as { exists?: boolean; userId?: string; canSignup?: boolean };
      if (rec.exists === true || rec.userId) return { status: "found", reason: "Notion lookupEmailOnboarding resolved a user." };
      if (rec.exists === false || rec.canSignup === true) return { status: "miss", reason: "Notion allows signup for this email." };
      return { status: "escalate", reason: "Notion onboarding lookup inconclusive." };
    });
  },
  slack: async (email) => {
    const domain = email.split("@")[1];
    const url = `https://slack.com/api/signup.checkEmail`;
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { ok?: boolean; error?: string };
      if (rec.error === "email_already_in_use" || rec.error === "already_in_team") {
        return { status: "found", reason: `Slack checkEmail error=${rec.error}.` };
      }
      if (rec.ok === true) return { status: "miss", reason: `Slack accepted ${domain} as unused.` };
      if (rec.error) return { status: "escalate", reason: `Slack checkEmail error=${rec.error}.` };
      return { status: "escalate", reason: "Slack checkEmail inconclusive." };
    });
  },
  microsoft: async (email) => {
    const url = "https://login.microsoftonline.com/common/GetCredentialType?mkt=en-US";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, isOtherIdpSupported: true, checkPhones: false, isRemoteNGCSupported: true, isCookieBannerShown: false, isFidoSupported: false, originalRequest: "", country: "US", forceotclogin: false, isExternalFederationDisallowed: false, isRemoteConnectSupported: false, federationFlags: 0, isSignup: false, flowToken: "" }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const ifExists = (j as { IfExistsResult?: number }).IfExistsResult;
      // 0 = exists, 1 = not found (consumer/common varies). Treat unknown as escalate.
      if (ifExists === 0) return { status: "found", reason: "Microsoft GetCredentialType IfExistsResult=0." };
      if (ifExists === 1) return { status: "miss", reason: "Microsoft GetCredentialType IfExistsResult=1." };
      return { status: "escalate", reason: `Microsoft IfExistsResult=${String(ifExists)}.` };
    });
  },
  flickr: async (email) => {
    const url = "https://identity.flickr.com/login";
    const res = await fetchPublic({
      url: `https://identity.flickr.com/login?username=${encodeURIComponent(email)}`,
      accept: "text/html",
    });
    const body = res.body.toLowerCase();
    if (body.includes("password") && !body.includes("couldn't find")) {
      return {
        verdict: { status: "found", reason: "Flickr identity login prompted for a password." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "password") },
      };
    }
    if (body.includes("couldn't find") || body.includes("we didn't recognize")) {
      return {
        verdict: { status: "miss", reason: "Flickr identity did not recognize the email." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  strava: async (email) => {
    const url = "https://www.strava.com/register";
    const res = await fetchPublic({
      url: "https://www.strava.com/athletes/email_unique",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.strava.com",
        Referer: "https://www.strava.com/register",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    const body = res.body.trim().toLowerCase();
    if (body === "false" || body.includes("\"unique\":false") || body.includes("already been taken")) {
      return {
        verdict: { status: "found", reason: "Strava email_unique reports the address is taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body === "true" || body.includes("\"unique\":true")) {
      return {
        verdict: { status: "miss", reason: "Strava email_unique reports the address is free." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  proton: async (email) => {
    const url = "https://mail.proton.me/api/core/v4/users/available";
    const local = email.split("@")[0];
    const res = await fetchPublic({
      url: `https://account.proton.me/api/core/v4/users/available?Name=${encodeURIComponent(local)}&ParseDomain=1`,
      accept: "application/json",
    });
    return jsonStatus(res, url, "GET", (j) => {
      const code = (j as { Code?: number }).Code;
      if (code === 1000) return { status: "miss", reason: "Proton available API Code=1000 (name free) — username check, not mailbox proof." };
      if (code === 1211 || code === 2500) return { status: "found", reason: `Proton available API Code=${code} (taken).` };
      return { status: "escalate", reason: `Proton available API Code=${String(code)}.` };
    });
  },
  eventbrite: async (email) => {
    const url = `https://www.eventbrite.com/ajax/signin/check_email/?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { exists?: boolean; email_exists?: boolean; user?: unknown };
      if (rec.exists === true || rec.email_exists === true || rec.user) {
        return { status: "found", reason: "Eventbrite check_email reports the address is registered." };
      }
      if (rec.exists === false || rec.email_exists === false) {
        return { status: "miss", reason: "Eventbrite check_email reports the address is unused." };
      }
      return { status: "escalate", reason: "Eventbrite check_email inconclusive." };
    });
  },
  vimeo: async (email) => {
    const url = "https://vimeo.com/join/validate";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://vimeo.com",
        Referer: "https://vimeo.com/join",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("already") || body.includes("taken") || body.includes("registered")) {
      return {
        verdict: { status: "found", reason: "Vimeo join validator reports the email is taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (res.status === 200 && (body.includes("ok") || body === "" || body.includes("true") || body.includes("valid"))) {
      return {
        verdict: { status: "miss", reason: "Vimeo join validator did not flag the email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  soundcloud: async (email) => {
    const url = "https://api-auth.soundcloud.com/web-auth/identifier";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://soundcloud.com" },
      body: JSON.stringify({ identifier: email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { next_step?: string; error?: string; status?: string };
      if (rec.next_step === "password" || rec.status === "existing") {
        return { status: "found", reason: "SoundCloud identifier next_step=password." };
      }
      if (rec.next_step === "signup" || rec.next_step === "register") {
        return { status: "miss", reason: "SoundCloud identifier next_step=signup." };
      }
      return { status: "escalate", reason: "SoundCloud identifier inconclusive." };
    });
  },
  patreon: async (email) => {
    const url = "https://www.patreon.com/api/email/available";
    const res = await fetchPublic({
      url: `${url}?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { data?: { available?: boolean }; available?: boolean };
      const available = rec.available ?? rec.data?.available;
      if (available === false) return { status: "found", reason: "Patreon email/available=false." };
      if (available === true) return { status: "miss", reason: "Patreon email/available=true." };
      return { status: "escalate", reason: "Patreon email available inconclusive." };
    });
  },
  shopify: async (email) => {
    const url = "https://accounts.shopify.com/lookup";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://accounts.shopify.com",
      },
      body: JSON.stringify({ email }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("password") || body.includes("\"exists\":true") || body.includes("login")) {
      return {
        verdict: { status: "found", reason: "Shopify accounts lookup resolved an identity." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body.includes("signup") || body.includes("\"exists\":false") || res.status === 404) {
      return {
        verdict: { status: "miss", reason: "Shopify accounts lookup found no account." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  bitbucket: async (email) => {
    const url = "https://bitbucket.org/account/signin/";
    const res = await fetchPublic({
      url: "https://bitbucket.org/account/signin/?next=/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://bitbucket.org",
        Referer: "https://bitbucket.org/account/signin/",
      },
      body: `username=${encodeURIComponent(email)}&submit=`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("password") && (body.includes("incorrect") || body.includes("invalid password") || body.includes("didn't match"))) {
      return {
        verdict: { status: "found", reason: "Bitbucket sign-in prompted for a password on this email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "password") },
      };
    }
    if (body.includes("we couldn't find") || body.includes("no account") || body.includes("doesn't exist")) {
      return {
        verdict: { status: "miss", reason: "Bitbucket sign-in did not recognize the email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  gitlab: async (email) => {
    const url = "https://gitlab.com/users/sign_in";
    const res = await fetchPublic({
      url: "https://gitlab.com/users",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://gitlab.com",
        Referer: "https://gitlab.com/users/sign_up",
      },
      body: `new_user[email]=${encodeURIComponent(email)}`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("already been taken") || body.includes("already registered") || body.includes("has already been taken")) {
      return {
        verdict: { status: "found", reason: "GitLab signup reports the email is already taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "taken") },
      };
    }
    if (res.status === 200 && !body.includes("taken")) {
      return {
        verdict: { status: "miss", reason: "GitLab signup did not flag the email as taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  keybase: async (email) => {
    const url = `https://keybase.io/_/api/1.0/user/lookup.json?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { status?: { code?: number; name?: string }; them?: unknown[] };
      if (Array.isArray(rec.them) && rec.them.length > 0) {
        return { status: "found", reason: "Keybase lookup.json resolved a user for this email." };
      }
      if (rec.status?.code === 0 && Array.isArray(rec.them) && rec.them.length === 0) {
        return { status: "miss", reason: "Keybase lookup.json returned no users." };
      }
      if (rec.status?.name === "not_found" || rec.status?.code === 205) {
        return { status: "miss", reason: "Keybase lookup.json not_found." };
      }
      return { status: "escalate", reason: "Keybase email lookup inconclusive." };
    });
  },
  plurk: async (email) => {
    const url = `https://www.plurk.com/Users/isEmailFound?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "application/json, text/plain, */*" });
    const body = res.body.trim().toLowerCase();
    if (body === "true" || body.includes("\"true\"")) {
      return {
        verdict: { status: "found", reason: "Plurk isEmailFound=true." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body === "false" || body.includes("\"false\"")) {
      return {
        verdict: { status: "miss", reason: "Plurk isEmailFound=false." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  venmo: async (email) => {
    const url = "https://api.venmo.com/v1/account/password-reset/request";
    void url;
    const check = `https://api.venmo.com/v1/users?query=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url: check, accept: "application/json" });
    return jsonStatus(res, check, "GET", (j) => {
      const rec = j as { data?: unknown[]; pagination?: unknown };
      if (Array.isArray(rec.data) && rec.data.length > 0) {
        return { status: "found", reason: "Venmo users query returned a match." };
      }
      if (Array.isArray(rec.data)) return { status: "miss", reason: "Venmo users query returned an empty list." };
      return { status: "escalate", reason: "Venmo users query inconclusive." };
    });
  },
  hibp: async (email) => {
    const key = process.env.HIBP_API_KEY?.trim();
    if (!key) {
      return {
        verdict: {
          status: "escalate",
          reason: "Have I Been Pwned skipped — set HIBP_API_KEY for live breach lookup.",
        },
        extras: { url: "https://haveibeenpwned.com/api/v3/breachedaccount", method: "GET" },
      };
    }
    const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
    const res = await fetchPublic({
      url,
      headers: { "hibp-api-key": key, "user-agent": "Umbra-OSINT" },
      accept: "application/json",
    });
    if (res.status === 404) {
      return {
        verdict: { status: "miss", reason: "HIBP reports no breaches for this address." },
        extras: { url, method: "GET", httpStatus: 404, latencyMs: res.latencyMs },
      };
    }
    if (res.status === 200) {
      let count = 0;
      try {
        count = (JSON.parse(res.body) as unknown[]).length;
      } catch {
        count = 0;
      }
      return {
        verdict: { status: "found", reason: `HIBP returned ${count} breach record(s).` },
        extras: {
          url,
          method: "GET",
          httpStatus: 200,
          latencyMs: res.latencyMs,
          metadata: { extra: { breaches: count } },
          bodyExcerpt: excerpt(res.body, "Name"),
        },
      };
    }
    return wrapHttp(res, url, "GET");
  },
};

export { handlers as extraHandlers };
