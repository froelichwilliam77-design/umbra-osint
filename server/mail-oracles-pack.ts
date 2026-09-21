import type { LedgerRow } from "../shared/types.ts";
import { type OracleVerdict } from "./oracles.ts";
import { fetchOracle, jsonStatus, takenOrAvailable } from "./mail-oracle-http.ts";

type OracleFn = (email: string) => Promise<{ verdict: OracleVerdict; extras: Partial<LedgerRow> }>;

function availabilityFlag(j: unknown, foundReason: string, missReason: string): OracleVerdict {
  const rec = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
  if (rec.available === true || nested.available === true) return { status: "miss", reason: missReason };
  if (rec.available === false || nested.available === false) return { status: "found", reason: foundReason };
  return existsFlag(j, ["exists", "taken"], foundReason, missReason);
}

function existsFlag(j: unknown, keys: string[], foundReason: string, missReason: string): OracleVerdict {
  const rec = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
  const nested = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : {};
  for (const key of keys) {
    if (rec[key] === true || nested[key] === true) return { status: "found", reason: foundReason };
    if (rec[key] === false || nested[key] === false) return { status: "miss", reason: missReason };
  }
  const blob = JSON.stringify(j).toLowerCase();
  if (/already|taken|exists|registered/.test(blob) && !/not[_ ]exist|available/.test(blob)) {
    return { status: "found", reason: foundReason };
  }
  return { status: "escalate", reason: `${foundReason.replace(/\..*/, "")} inconclusive.` };
}

const handlers: Record<string, OracleFn> = {
  amazon: async (email) => {
    const url = "https://www.amazon.com/ap/register";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.amazon.com",
        Referer: "https://www.amazon.com/ap/register",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already exists", "account already exists", "you indicated you are a new customer", "password-claim"],
      available: ["verify email", "create your amazon account", "enter a password"],
      foundReason: "Amazon register reports the email is already registered.",
      missReason: "Amazon register did not flag the email as taken.",
    });
  },
  quora: async (email) => {
    const url = `https://www.quora.com/webnode2/server_call_POST?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({
      url: "https://www.quora.com/_/validate_email",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.quora.com",
        Referer: "https://www.quora.com/signup",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    void url;
    return takenOrAvailable(res, "https://www.quora.com/_/validate_email", "POST", {
      taken: ["already registered", "already have an account", "email is taken", "account exists"],
      available: ["valid email", "looks good", "available"],
      foundReason: "Quora validate_email reports the address is registered.",
      missReason: "Quora validate_email did not report the address as taken.",
    });
  },
  lichess: async (email) => {
    const url = "https://lichess.org/signup";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://lichess.org",
        Referer: "https://lichess.org/signup",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["email already in use", "already registered", "email is already", "taken"],
      available: ["almost there", "check your email", "confirm your email"],
      foundReason: "Lichess signup reports the email is already in use.",
      missReason: "Lichess signup did not flag the email as taken.",
    });
  },
  kaggle: async (email) => {
    const url = "https://www.kaggle.com/api/i/users.UsersService/EmailAvailability";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://www.kaggle.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      availabilityFlag(j, "Kaggle EmailAvailability=false (taken).", "Kaggle EmailAvailability=true."),
    );
  },
  hackerone: async (email) => {
    const url = `https://hackerone.com/users/check_email?email=${encodeURIComponent(email)}`;
    const res = await fetchOracle({ url, accept: "application/json", headers: { Referer: "https://hackerone.com/users/sign_up" } });
    return jsonStatus(res, url, "GET", (j) =>
      existsFlag(j, ["exists", "taken"], "HackerOne check_email exists=true.", "HackerOne check_email exists=false."),
    );
  },
  bandcamp: async (email) => {
    const url = "https://bandcamp.com/forgot_password";
    void url;
    const signup = "https://bandcamp.com/signup";
    const res = await fetchOracle({
      url: signup,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://bandcamp.com",
        Referer: signup,
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, signup, "POST", {
      taken: ["already in use", "already registered", "email taken", "account exists"],
      available: ["check your email", "confirm your email", "welcome to bandcamp"],
      foundReason: "Bandcamp signup reports the email is already in use.",
      missReason: "Bandcamp signup did not flag the email as taken.",
    });
  },
  orcid: async (email) => {
    const url = "https://orcid.org/register";
    const res = await fetchOracle({
      url: `https://orcid.org/register/verify-email.json?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    void url;
    return jsonStatus(res, `https://orcid.org/register/verify-email.json?email=${encodeURIComponent(email)}`, "GET", (j) =>
      availabilityFlag(j, "ORCID email verify reports taken.", "ORCID email verify reports available."),
    );
  },
  sourcehut: async (email) => {
    const url = "https://meta.sr.ht/register";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://meta.sr.ht",
        Referer: url,
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already registered", "already in use", "account exists"],
      available: ["check your inbox", "confirm your email"],
      foundReason: "SourceHut register reports the email is already in use.",
      missReason: "SourceHut register did not flag the email as taken.",
    });
  },
  codeberg: async (email) => {
    const url = "https://codeberg.org/user/sign_up";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://codeberg.org",
        Referer: url,
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already been taken", "already registered", "email has already"],
      available: ["account activation", "check your email"],
      foundReason: "Codeberg sign_up reports the email is taken.",
      missReason: "Codeberg sign_up did not flag the email as taken.",
    });
  },
  codesandbox: async (email) => {
    const url = "https://codesandbox.io/api/v1/users/mailcheck";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://codesandbox.io" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "CodeSandbox mailcheck exists=true.", "CodeSandbox mailcheck exists=false."),
    );
  },
  gitpod: async (email) => {
    const url = "https://gitpod.io/api/signup";
    const res = await fetchOracle({
      url: `https://gitpod.io/api/login/check?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    void url;
    return jsonStatus(res, `https://gitpod.io/api/login/check?email=${encodeURIComponent(email)}`, "GET", (j) =>
      existsFlag(j, ["exists", "registered"], "Gitpod login/check exists=true.", "Gitpod login/check exists=false."),
    );
  },
  gemini: async (email) => {
    const url = "https://exchange.gemini.com/register";
    const res = await fetchOracle({
      url: "https://api.gemini.com/v1/account/available",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://exchange.gemini.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://api.gemini.com/v1/account/available", "POST", (j) =>
      availabilityFlag(j, "Gemini account/available reports taken.", "Gemini account/available reports unused."),
    );
  },
  render: async (email) => {
    const url = "https://api.render.com/v1/signup";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://dashboard.render.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Render signup exists=true.", "Render signup exists=false."),
    );
  },
  flyio: async (email) => {
    const url = "https://api.fly.io/api/v1/registrations";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://fly.io" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Fly.io registrations exists=true.", "Fly.io registrations exists=false."),
    );
  },
  brevo: async (email) => {
    const url = "https://app.brevo.com/account/register";
    const res = await fetchOracle({
      url: "https://app.brevo.com/account/email-availability",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://app.brevo.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://app.brevo.com/account/email-availability", "POST", (j) =>
      availabilityFlag(j, "Brevo email-availability reports taken.", "Brevo email-availability reports unused."),
    );
  },
  mailgun: async (email) => {
    const url = "https://signup.mailgun.com/signup/validate";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://signup.mailgun.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Mailgun signup validate exists=true.", "Mailgun signup validate exists=false."),
    );
  },
  postmark: async (email) => {
    const url = "https://account.postmarkapp.com/sign_up";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://account.postmarkapp.com",
        Referer: url,
      },
      body: `user%5Bemail%5D=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already been taken", "already registered", "email has already"],
      available: ["check your email", "confirm your account"],
      foundReason: "Postmark sign_up reports the email is taken.",
      missReason: "Postmark sign_up did not flag the email as taken.",
    });
  },
  bitly: async (email) => {
    const url = "https://bitly.com/a/sign_up";
    const res = await fetchOracle({
      url: "https://api-ssl.bitly.com/v4/signup/email",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://bitly.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://api-ssl.bitly.com/v4/signup/email", "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Bitly signup/email exists=true.", "Bitly signup/email exists=false."),
    );
  },
  anilist: async (email) => {
    const url = "https://anilist.co/api/v2/User";
    const res = await fetchOracle({
      url: "https://anilist.co/api/v2/auth/register",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://anilist.co" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://anilist.co/api/v2/auth/register", "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "AniList register exists=true.", "AniList register exists=false."),
    );
  },
  goodreads: async (email) => {
    const url = "https://www.goodreads.com/user/sign_up";
    const res = await fetchOracle({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.goodreads.com",
        Referer: url,
      },
      body: `user%5Bemail%5D=${encodeURIComponent(email)}`,
    });
    return takenOrAvailable(res, url, "POST", {
      taken: ["already been taken", "already registered", "email has already"],
      available: ["check your email", "confirm your email"],
      foundReason: "Goodreads sign_up reports the email is taken.",
      missReason: "Goodreads sign_up did not flag the email as taken.",
    });
  },
  peloton: async (email) => {
    const url = "https://api.onepeloton.com/auth/check_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://www.onepeloton.com" },
      body: JSON.stringify({ email_address: email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "is_registered"], "Peloton check_email exists=true.", "Peloton check_email exists=false."),
    );
  },
  fitbit: async (email) => {
    const url = "https://www.fitbit.com/setup/api/users";
    const res = await fetchOracle({
      url: `https://www.fitbit.com/signup/checkemail?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    void url;
    return jsonStatus(res, `https://www.fitbit.com/signup/checkemail?email=${encodeURIComponent(email)}`, "GET", (j) =>
      existsFlag(j, ["exists", "taken"], "Fitbit checkemail exists=true.", "Fitbit checkemail exists=false."),
    );
  },
  alltrails: async (email) => {
    const url = "https://www.alltrails.com/api/alltrails/users/check_email";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://www.alltrails.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "AllTrails check_email exists=true.", "AllTrails check_email exists=false."),
    );
  },
  humble: async (email) => {
    const url = "https://www.humblebundle.com/signup";
    const res = await fetchOracle({
      url: "https://www.humblebundle.com/signup/check",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://www.humblebundle.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://www.humblebundle.com/signup/check", "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Humble Bundle signup/check exists=true.", "Humble Bundle signup/check exists=false."),
    );
  },
  gog: async (email) => {
    const url = "https://login.gog.com/register";
    const res = await fetchOracle({
      url: `https://login.gog.com/register/check_email?email=${encodeURIComponent(email)}`,
      accept: "application/json",
    });
    void url;
    return jsonStatus(res, `https://login.gog.com/register/check_email?email=${encodeURIComponent(email)}`, "GET", (j) =>
      existsFlag(j, ["exists", "taken"], "GOG check_email exists=true.", "GOG check_email exists=false."),
    );
  },
  ea: async (email) => {
    const url = "https://signin.ea.com/p/juno/create";
    const res = await fetchOracle({
      url: "https://accounts.ea.com/connect/auth",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://signin.ea.com",
      },
      body: `email=${encodeURIComponent(email)}`,
    });
    void url;
    return takenOrAvailable(res, "https://accounts.ea.com/connect/auth", "POST", {
      taken: ["already registered", "already exists", "email is already"],
      available: ["create your ea account", "choose a password"],
      foundReason: "EA accounts report the email is already registered.",
      missReason: "EA accounts did not flag the email as taken.",
    });
  },
  riot: async (email) => {
    const url = "https://auth.riotgames.com/api/v1/authorization";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://auth.riotgames.com" },
      body: JSON.stringify({ username: email, type: "auth" }),
    });
    return jsonStatus(res, url, "POST", (j) => {
      const rec = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
      const err = String(rec.error ?? rec.type ?? "").toLowerCase();
      if (/auth_failure|invalid_credentials|rate_limited/.test(err)) {
        return { status: "found", reason: `Riot auth recognized the identifier (${err}).` };
      }
      if (/user_not_found|not_found/.test(err)) {
        return { status: "miss", reason: "Riot auth user_not_found." };
      }
      return existsFlag(j, ["exists"], "Riot authorization exists=true.", "Riot authorization exists=false.");
    });
  },
  playstation: async (email) => {
    const url = "https://ca.account.sony.com/api/v1/ssocookie";
    const res = await fetchOracle({
      url: "https://ca.account.sony.com/api/v1/ssocookie",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://id.sonyentertainmentnetwork.com" },
      body: JSON.stringify({ authentication_type: "password", username: email }),
    });
    void url;
    return jsonStatus(res, "https://ca.account.sony.com/api/v1/ssocookie", "POST", (j) => {
      const blob = JSON.stringify(j).toLowerCase();
      if (/invalid_credentials|incorrect password|wrong password/.test(blob)) {
        return { status: "found", reason: "PlayStation SSO reports invalid credentials (email recognized)." };
      }
      if (/user not found|not found|unknown user/.test(blob)) {
        return { status: "miss", reason: "PlayStation SSO did not recognize the email." };
      }
      return { status: "escalate", reason: "PlayStation SSO inconclusive." };
    });
  },
  nintendo: async (email) => {
    const url = "https://accounts.nintendo.com/api/core/v1/gateway/email";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://accounts.nintendo.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "registered"], "Nintendo email gateway exists=true.", "Nintendo email gateway exists=false."),
    );
  },
  netlify: async (email) => {
    const url = "https://app.netlify.com/signup";
    const res = await fetchOracle({
      url: "https://app.netlify.com/access-control/bb-api/api/v1/account_existence",
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://app.netlify.com" },
      body: JSON.stringify({ email }),
    });
    void url;
    return jsonStatus(res, "https://app.netlify.com/access-control/bb-api/api/v1/account_existence", "POST", (j) =>
      existsFlag(j, ["exists"], "Netlify account_existence exists=true.", "Netlify account_existence exists=false."),
    );
  },
  supabase: async (email) => {
    const url = "https://api.supabase.com/platform/signup";
    const res = await fetchOracle({
      url,
      method: "POST",
      accept: "application/json",
      headers: { "Content-Type": "application/json", Origin: "https://supabase.com" },
      body: JSON.stringify({ email }),
    });
    return jsonStatus(res, url, "POST", (j) =>
      existsFlag(j, ["exists", "taken"], "Supabase signup exists=true.", "Supabase signup exists=false."),
    );
  },
};

export { handlers as packHandlers };
