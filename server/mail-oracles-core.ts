import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { fetchOracle, fetchOracleFollow, jsonStatus, wrapHttp } from "./mail-oracle-http.ts";
import { type OracleVerdict } from "./oracles.ts";
import { md5, gravatarProfile } from "./mail-util.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

const handlers: Record<string, OracleFn> = {
  gravatar: async (email) => {
    const hash = md5(email);
    const url = `https://en.gravatar.com/${hash}.json`;
    const res = await fetchOracle({ url, accept: "application/json" });
    if (res.status === 200) {
      const g = await gravatarProfile(email);
      return {
        verdict: { status: "found", reason: "Gravatar profile JSON returned 200." },
        extras: {
          url,
          method: "GET",
          httpStatus: 200,
          latencyMs: res.latencyMs,
          bodyExcerpt: excerpt(res.body, "displayName"),
          metadata: {
            displayName: g.displayName,
            avatarUrl: g.avatarUrl,
            website: g.profileUrl,
            extra: { accounts: g.accounts?.length ?? 0 },
          },
        },
      };
    }
    if (res.status === 404) {
      return {
        verdict: { status: "miss", reason: "No Gravatar profile (404)." },
        extras: { url, method: "GET", httpStatus: 404, latencyMs: res.latencyMs },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  spotify: async (email) => {
    const url = `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const status = Number((j as { status?: number }).status);
      if (status === 20) return { status: "found", reason: "Spotify signup oracle status=20 (registered)." };
      if (status === 1) return { status: "miss", reason: "Spotify signup oracle status=1 (available)." };
      if (status === 38 || status === 0) return { status: "blocked", reason: `Spotify rate-limit/oracle status=${status}.` };
      return { status: "escalate", reason: `Unexpected Spotify status=${status}.` };
    });
  },
  adobe: async (email) => {
    const url = "https://auth.services.adobe.com/signin/v1/authenticationstate";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "X-IMS-CLIENTID": "adobedotcom2",
        Origin: "https://auth.services.adobe.com",
      },
      body: JSON.stringify({ username: email, accountType: "individual" }),
    });
    if (res.status === 0) return wrapHttp(res, url, "POST");
    try {
      const j = JSON.parse(res.body) as Record<string, unknown>;
      if (j.errorCode) {
        const code = String(j.errorCode);
        const status = /invalid_authentication|unauthorized|denied/i.test(code) ? "escalate" : "miss";
        return {
          verdict: { status, reason: `Adobe returned errorCode=${code}.` },
          extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "errorCode") },
        };
      }
      if (j.id || j["authentication-state"] || j.authenticationState) {
        return {
          verdict: { status: "found", reason: "Adobe authentication-state issued for this username." },
          extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "id") },
        };
      }
      return {
        verdict: { status: "escalate", reason: "Adobe response had neither errorCode nor state id." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    } catch {
      return wrapHttp(res, url, "POST");
    }
  },
  github: async (email) => {
    const url = "https://github.com/signup_check/email";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://github.com",
        Referer: "https://github.com/signup",
      },
      body: `value=${encodeURIComponent(email)}`,
    });
    const body = res.body.toLowerCase();
    if (res.status === 422 || body.includes("already") || body.includes("taken")) {
      return {
        verdict: { status: "found", reason: "GitHub signup_check reports the email is taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (res.status === 200 && (body === "" || body.includes("available") || body === "[]")) {
      return {
        verdict: { status: "miss", reason: "GitHub signup_check accepted the email as available." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  archive: async (email) => {
    const url = "https://archive.org/account/s3.php?your_email=" + encodeURIComponent(email);
    const res = await fetchOracle({
      url: `https://archive.org/account/signup`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent(email)}&screenname=umbraoracle&password=x&submit=Sign+up`,
    });
    void url;
    const body = res.body.toLowerCase();
    if (body.includes("already been taken") || body.includes("already registered") || body.includes("is already")) {
      return {
        verdict: { status: "found", reason: "archive.org signup form reports the email is already used." },
        extras: { url: "https://archive.org/account/signup", method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "already") },
      };
    }
    if (res.status === 200 && (body.includes("verify") || body.includes("create"))) {
      return {
        verdict: { status: "miss", reason: "archive.org did not flag the address as registered." },
        extras: { url: "https://archive.org/account/signup", method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, "https://archive.org/account/signup", "POST");
  },
  duolingo: async (email) => {
    const url = `https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const users = (j as { users?: unknown[] }).users;
      if (Array.isArray(users) && users.length > 0) {
        return { status: "found", reason: "Duolingo users API returned a match." };
      }
      if (Array.isArray(users)) return { status: "miss", reason: "Duolingo users API returned an empty list." };
      return { status: "escalate", reason: "Duolingo response lacked a users array." };
    });
  },
  chess: async (email) => {
    const url = "https://www.chess.com/callback/email/available";
    const res = await fetchOracle({
      url: `${url}?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    return jsonStatus(res, `${url}?email=`, "GET", (j) => {
      const available = (j as { isEmailAvailable?: boolean }).isEmailAvailable;
      if (available === false) return { status: "found", reason: "Chess.com reports email unavailable." };
      if (available === true) return { status: "miss", reason: "Chess.com reports email available." };
      return { status: "escalate", reason: "Chess.com response missing isEmailAvailable." };
    });
  },
  pinterest: async (email) => {
    const url = "https://www.pinterest.com/_ngjs/resource/EmailExistsResource/create/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.pinterest.com",
        Referer: "https://www.pinterest.com/",
      },
      body: `source_url=/&data=${encodeURIComponent(JSON.stringify({ options: { email }, context: {} }))}`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("\"emailexists\":true") || body.includes("\"email_exists\":true")) {
      return {
        verdict: { status: "found", reason: "Pinterest EmailExistsResource is true." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "email") },
      };
    }
    if (body.includes("\"emailexists\":false") || body.includes("\"email_exists\":false")) {
      return {
        verdict: { status: "miss", reason: "Pinterest EmailExistsResource is false." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "email") },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  tumblr: async (email) => {
    const url = `https://www.tumblr.com/svc/account/register?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url: "https://www.tumblr.com/svc/account/register",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.tumblr.com",
        Referer: "https://www.tumblr.com/register",
      },
      body: `email=${encodeURIComponent(email)}&action=signup_account`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("already") || body.includes("taken") || res.status === 400) {
      return {
        verdict: { status: "found", reason: "Tumblr register SVC flagged the email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  imgur: async (email) => {
    const url = "https://imgur.com/signin/ajax_email_available";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://imgur.com",
        Referer: "https://imgur.com/register",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", (j) => {
      const data = j as { data?: { available?: boolean } };
      if (data.data?.available === false) return { status: "found", reason: "Imgur ajax_email_available=false." };
      if (data.data?.available === true) return { status: "miss", reason: "Imgur ajax_email_available=true." };
      return { status: "escalate", reason: "Imgur response missing availability flag." };
    });
  },
  wordpress: async (email) => {
    const url = `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(email)}/auth-options`;
    const res = await fetchOracle({ url, accept: "application/json" });
    if (res.status === 404) {
      return {
        verdict: { status: "miss", reason: "WordPress.com auth-options 404 — no account." },
        extras: { url, method: "GET", httpStatus: 404, latencyMs: res.latencyMs },
      };
    }
    if (res.status === 200) {
      return {
        verdict: { status: "found", reason: "WordPress.com auth-options returned a profile." },
        extras: { url, method: "GET", httpStatus: 200, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  atlassian: async (email) => {
    const url = "https://id.atlassian.com/gateway/api/signup/validEmail";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://id.atlassian.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { valid?: boolean; accountExists?: boolean; error?: string };
      if (rec.accountExists === true || rec.error?.toLowerCase().includes("exist")) {
        return { status: "found", reason: "Atlassian reports the email already has an account." };
      }
      if (rec.valid === true && rec.accountExists === false) {
        return { status: "miss", reason: "Atlassian reports a valid unused email." };
      }
      return { status: "escalate", reason: "Atlassian response was inconclusive." };
    });
  },
  dropbox: async (email) => {
    const url = "https://www.dropbox.com/web_elements/login?email=" + encodeURIComponent(email);
    const res = await fetchOracleFollow({
      url: "https://www.dropbox.com/sso/" + encodeURIComponent(email),
      accept: "text/html",
    });
    const body = res.body.toLowerCase();
    if (body.includes("sso") && (body.includes("continue") || body.includes("google"))) {
      return {
        verdict: { status: "found", reason: "Dropbox SSO surface rendered for this address." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body, "sso") },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  hubspot: async (email) => {
    const url = "https://api.hubspot.com/login-verify/v1/users/login-precheck";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.hubspot.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { identity?: unknown; status?: string; message?: string };
      if (rec.identity || rec.status === "OK") {
        return { status: "found", reason: "HubSpot login-precheck resolved an identity." };
      }
      if (res.status === 404 || String(rec.message || "").toLowerCase().includes("not found")) {
        return { status: "miss", reason: "HubSpot login-precheck found no user." };
      }
      return { status: "escalate", reason: "HubSpot precheck inconclusive." };
    });
  },
  mozilla: async (email) => {
    const url = "https://api.accounts.firefox.com/v1/account/status";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const exists = (j as { exists?: boolean }).exists;
      if (exists === true) return { status: "found", reason: "Firefox Accounts status exists=true." };
      if (exists === false) return { status: "miss", reason: "Firefox Accounts status exists=false." };
      return { status: "escalate", reason: "Firefox Accounts status missing exists flag." };
    });
  },
  twitter: async (email) => {
    const url = `https://api.twitter.com/i/users/email_available.json?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const taken = (j as { taken?: boolean }).taken;
      if (taken === true) return { status: "found", reason: "X/Twitter email_available taken=true." };
      if (taken === false) return { status: "miss", reason: "X/Twitter email_available taken=false." };
      return { status: "escalate", reason: "X/Twitter email_available inconclusive." };
    });
  },
  instagram: async (email) => {
    const url = "https://www.instagram.com/api/v1/web/accounts/check_email/";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.instagram.com",
        Referer: "https://www.instagram.com/accounts/emailsignup/",
        "X-Instagram-AJAX": "1",
        "X-CSRFToken": "missing",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { valid?: boolean; available?: boolean; error_type?: string };
      if (rec.available === false || rec.error_type === "email_is_taken") {
        return { status: "found", reason: "Instagram check_email reports taken." };
      }
      if (rec.available === true || rec.valid === true) {
        return { status: "miss", reason: "Instagram check_email reports available." };
      }
      return { status: "escalate", reason: "Instagram check_email inconclusive (likely CSRF/WAF)." };
    });
  },
  lastfm: async (email) => {
    const url = `https://www.last.fm/join/partial/validate?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json" });
    const body = res.body.toLowerCase();
    if (body.includes("sorry, this email") || body.includes("already registered") || body.includes("taken")) {
      return {
        verdict: { status: "found", reason: "Last.fm join validator reports the email is taken." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (res.status === 200 && (body.includes("ok") || body === "{}" || body.includes("true"))) {
      return {
        verdict: { status: "miss", reason: "Last.fm join validator did not flag the email." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "GET");
  }
};

export { handlers as coreHandlers };
