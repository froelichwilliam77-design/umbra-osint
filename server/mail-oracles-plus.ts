import type { LedgerRow } from "../shared/types.ts";
import { excerpt } from "./classify.ts";
import { fetchPublic } from "./http.ts";
import { type OracleVerdict } from "./oracles.ts";
import { jsonStatus, wrapHttp } from "./mail-oracle-http.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

/**
 * Silent existence oracles only — lookup / available / exists endpoints.
 * Never password-reset, never signup-with-password (those can email the subject).
 */
const handlers: Record<string, OracleFn> = {
  gmail: async (email) => {
    const url = `https://mail.google.com/mail/gxlu?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "*/*" });
    const cookies = res.headers["set-cookie"] ?? "";
    if (cookies) {
      return {
        verdict: { status: "found", reason: "Gmail gxlu issued Set-Cookie (COMPASS) — mailbox exists." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: cookies.slice(0, 120) },
      };
    }
    if (res.status === 204 || res.status === 200 || res.status === 302) {
      return {
        verdict: { status: "miss", reason: "Gmail gxlu returned no cookies — no Google account for this address." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  yahoo: async (email) => {
    const url = "https://login.yahoo.com/account/module/create?validateField=userId";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://login.yahoo.com",
        Referer: "https://login.yahoo.com/account/create",
      },
      body: `specId=yidReg&userId=${encodeURIComponent(email)}&done=https%3A%2F%2Fwww.yahoo.com&domain=yahoo.com`,
    });
    const body = res.body.toLowerCase();
    if (body.includes("identifier exists") || body.includes("already taken") || (body.includes("err_name") && body.includes("exists"))) {
      return {
        verdict: { status: "found", reason: "Yahoo create validator reports the identifier exists." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body.includes("\"error\"") && (body.includes("invalid") || body.includes("not available"))) {
      return {
        verdict: { status: "found", reason: "Yahoo create validator rejected the address as taken/invalid-in-use." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (res.status === 200 && (body.includes("ok") || body === "{}" || body.includes("success"))) {
      return {
        verdict: { status: "miss", reason: "Yahoo create validator did not flag the address." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  zoho: async (email) => {
    const url = `https://accounts.zoho.com/signin/v2/lookup/${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { status_code?: number; code?: string; lookup?: { identifier?: string }; message?: string };
      if (rec.lookup?.identifier || rec.status_code === 201 || rec.code === "U201") {
        return { status: "found", reason: "Zoho signin lookup resolved an identifier." };
      }
      if (rec.status_code === 400 || rec.code === "U401" || String(rec.message || "").toLowerCase().includes("no account")) {
        return { status: "miss", reason: "Zoho signin lookup found no account." };
      }
      return { status: "escalate", reason: `Zoho lookup inconclusive (${rec.code ?? rec.status_code ?? "no code"}).` };
    });
  },
  replit: async (email) => {
    const url = "https://replit.com/data/user/exists";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://replit.com", Referer: "https://replit.com/signup" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const exists = (j as { exists?: boolean }).exists;
      if (exists === true) return { status: "found", reason: "Replit /data/user/exists=true." };
      if (exists === false) return { status: "miss", reason: "Replit /data/user/exists=false." };
      return { status: "escalate", reason: "Replit exists flag missing." };
    });
  },
  codecademy: async (email) => {
    const url = "https://www.codecademy.com/register/check";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://www.codecademy.com" },
      body: JSON.stringify({ user: { email } }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("already") || body.includes("taken") || body.includes("has been taken")) {
      return {
        verdict: { status: "found", reason: "Codecademy register/check reports the email is taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (res.status === 200 && (body.includes("true") || body === "{}" || body.includes("ok"))) {
      return {
        verdict: { status: "miss", reason: "Codecademy register/check did not flag the email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  buymeacoffee: async (email) => {
    const url = "https://www.buymeacoffee.com/api/creator/login/check-email";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.buymeacoffee.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { exists?: boolean; data?: { exists?: boolean }; message?: string };
      const exists = rec.exists ?? rec.data?.exists;
      if (exists === true) return { status: "found", reason: "Buy Me a Coffee check-email exists=true." };
      if (exists === false) return { status: "miss", reason: "Buy Me a Coffee check-email exists=false." };
      if (String(rec.message || "").toLowerCase().includes("already")) {
        return { status: "found", reason: "Buy Me a Coffee reports the email is already registered." };
      }
      return { status: "escalate", reason: "Buy Me a Coffee check-email inconclusive." };
    });
  },
  myfitnesspal: async (email) => {
    const url = `https://www.myfitnesspal.com/api/auth/validateEmail?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({ url, accept: "application/json" });
    const body = res.body.toLowerCase();
    if (body.includes("taken") || body.includes("already") || body.includes("\"valid\":false")) {
      return {
        verdict: { status: "found", reason: "MyFitnessPal validateEmail reports the address is taken." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body.includes("\"valid\":true") || body.includes("available")) {
      return {
        verdict: { status: "miss", reason: "MyFitnessPal validateEmail reports the address is available." },
        extras: { url, method: "GET", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "GET");
  },
  nike: async (email) => {
    const url = `https://unite.nike.com/account/email/exists?email=${encodeURIComponent(email)}`;
    const res = await fetchPublic({
      url,
      headers: { Origin: "https://www.nike.com", Referer: "https://www.nike.com/" },
      accept: "application/json",
    });
    return jsonStatus(res, url, "GET", (j) => {
      const exists = (j as { exists?: boolean }).exists;
      if (exists === true) return { status: "found", reason: "Nike unite email/exists=true." };
      if (exists === false) return { status: "miss", reason: "Nike unite email/exists=false." };
      return { status: "escalate", reason: "Nike email exists inconclusive." };
    });
  },
  komoot: async (email) => {
    const url = "https://account.komoot.com/v1/signin";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://account.komoot.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { type?: string; error?: string; login_type?: string };
      if (rec.type === "registered" || rec.login_type || rec.type === "password") {
        return { status: "found", reason: `Komoot signin type=${rec.type ?? rec.login_type}.` };
      }
      if (rec.type === "unregistered" || rec.error === "user_not_found") {
        return { status: "miss", reason: "Komoot signin reports unregistered." };
      }
      return { status: "escalate", reason: "Komoot signin inconclusive." };
    });
  },
  canva: async (email) => {
    const url = "https://www.canva.com/_ajax/email/exists";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.canva.com", Referer: "https://www.canva.com/" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { exists?: boolean; status?: string };
      if (rec.exists === true) return { status: "found", reason: "Canva _ajax/email/exists=true." };
      if (rec.exists === false) return { status: "miss", reason: "Canva _ajax/email/exists=false." };
      return { status: "escalate", reason: "Canva email exists inconclusive." };
    });
  },
  freelancer: async (email) => {
    const url = `https://www.freelancer.com/api/users/0.1/users?emails[]=${encodeURIComponent(email)}&compact=true`;
    const res = await fetchPublic({ url, accept: "application/json" });
    return jsonStatus(res, url, "GET", (j) => {
      const rec = j as { result?: { users?: Record<string, unknown> }; users?: unknown[] };
      const users = rec.result?.users;
      if (users && Object.keys(users).length > 0) {
        return { status: "found", reason: "Freelancer users API resolved this email." };
      }
      if (users && Object.keys(users).length === 0) {
        return { status: "miss", reason: "Freelancer users API returned no users." };
      }
      return { status: "escalate", reason: "Freelancer users API inconclusive." };
    });
  },
  anydo: async (email) => {
    const url = "https://sm-prod2.any.do/check_email";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { user_exists?: boolean; exists?: boolean };
      const exists = rec.user_exists ?? rec.exists;
      if (exists === true) return { status: "found", reason: "Any.do check_email user_exists=true." };
      if (exists === false) return { status: "miss", reason: "Any.do check_email user_exists=false." };
      return { status: "escalate", reason: "Any.do check_email inconclusive." };
    });
  },
  deliveroo: async (email) => {
    const url = "https://deliveroo.co.uk/orderapp/v1/check-email";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://deliveroo.co.uk" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { registered?: boolean; exists?: boolean };
      if (rec.registered === true || rec.exists === true) {
        return { status: "found", reason: "Deliveroo check-email reports registered." };
      }
      if (rec.registered === false || rec.exists === false) {
        return { status: "miss", reason: "Deliveroo check-email reports unused." };
      }
      return { status: "escalate", reason: "Deliveroo check-email inconclusive." };
    });
  },
  xing: async (email) => {
    const url = "https://login.xing.com/login/api/login";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://login.xing.com" },
      body: JSON.stringify({ username: email }),
    });
    const body = res.body.toLowerCase();
    if (body.includes("password") || body.includes("user_found") || body.includes("\"exists\":true")) {
      return {
        verdict: { status: "found", reason: "XING login API prompted for a password / found the user." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body.includes("not found") || body.includes("unknown") || body.includes("\"exists\":false")) {
      return {
        verdict: { status: "miss", reason: "XING login API did not recognize the email." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
  envato: async (email) => {
    const url = "https://account.envato.com/api/public/v1/session/create";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://account.envato.com" },
      body: JSON.stringify({ username: email }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j as { state?: string; error?: string };
      if (rec.state === "password" || rec.state === "exists") {
        return { status: "found", reason: `Envato session/create state=${rec.state}.` };
      }
      if (rec.state === "register" || rec.state === "signup" || rec.error === "user_not_found") {
        return { status: "miss", reason: `Envato session/create state=${rec.state ?? rec.error}.` };
      }
      return { status: "escalate", reason: "Envato session/create inconclusive." };
    });
  },
  deezer: async (email) => {
    const url = "https://www.deezer.com/ajax/action.php";
    const res = await fetchPublic({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://www.deezer.com",
        Referer: "https://www.deezer.com/register",
      },
      body: `type=REGISTER&mail=${encodeURIComponent(email)}`,
    });
    const body = res.body.trim().toLowerCase();
    if (body.includes("already") || body === "taken" || body.includes("exist")) {
      return {
        verdict: { status: "found", reason: "Deezer REGISTER action reports the email is taken." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    if (body === "success" || body === "ok" || body === "true") {
      return {
        verdict: { status: "miss", reason: "Deezer REGISTER action accepted the email as available." },
        extras: { url, method: "POST", httpStatus: res.status, latencyMs: res.latencyMs, bodyExcerpt: excerpt(res.body) },
      };
    }
    return wrapHttp(res, url, "POST");
  },
};

export { handlers as plusHandlers };
