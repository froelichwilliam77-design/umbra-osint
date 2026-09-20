export interface UserAgentProfile {
  value: string;
  platform: string;
  secChUa: string;
}

const PROFILES: UserAgentProfile[] = [
  {
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "Windows",
    secChUa: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
  },
  {
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "macOS",
    secChUa: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
  },
  {
    value:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    platform: "Linux",
    secChUa: `"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"`,
  },
];

export function pickUserAgent(): UserAgentProfile {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

export function allUserAgents(): UserAgentProfile[] {
  return PROFILES;
}
