export const HANDLE_MIN = 1;
export const HANDLE_MAX = 64;
export const HANDLE_REGEX = /^[A-Za-z0-9._-]+$/;

export const ROLE_LOCAL_PARTS = new Set([
  "admin",
  "administrator",
  "abuse",
  "billing",
  "contact",
  "devops",
  "hello",
  "help",
  "hostmaster",
  "info",
  "jobs",
  "mail",
  "noc",
  "office",
  "postmaster",
  "press",
  "privacy",
  "root",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

export const LOGIN_PATH_HINTS = [
  "/login",
  "/signin",
  "/sign-in",
  "/signup",
  "/sign-up",
  "/register",
  "/explore",
  "/discover",
  "/home",
  "/welcome",
  "/accounts/login",
  "/users/sign_in",
  "/session/new",
  "/auth/login",
];

export const WAF_BODY_HINTS = [
  "captcha",
  "hcaptcha",
  "recaptcha",
  "cf-ray",
  "cf-challenge",
  "attention required",
  "access denied",
  "request blocked",
  "forbidden",
  "checking your browser",
  "just a moment",
  "enable javascript and cookies",
  "akamai",
  "incapsula",
  "sucuri",
  "ddos-guard",
  "blocked by",
  "why have i been blocked",
  "cloudflare",
];

export const WAF_HEADER_HINTS = [
  "cf-mitigated",
  "cf-chl-bypass",
];

export const AUTHORIZED_USE =
  "Umbra is a public-OSINT workstation. Run it only against identifiers you are authorized to investigate. It never sends SMTP or password-reset mail to a subject.";
