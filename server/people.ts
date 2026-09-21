/** Public people-search URLs / documented free search pages. Never buy or scrape broker dumps. */

export function peopleSearchLinks(identifier: string, kind: "mail" | "handle" | "phone" | "host"): { label: string; url: string }[] {
  const q = identifier.trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const quoted = encodeURIComponent(`"${q}"`);
  const links: { label: string; url: string }[] = [
    { label: "Google", url: `https://www.google.com/search?q=${quoted}` },
    { label: "DuckDuckGo", url: `https://duckduckgo.com/?q=${quoted}` },
    { label: "LinkedIn (Google)", url: `https://www.google.com/search?q=site%3Alinkedin.com+${quoted}` },
    { label: "X / Twitter (Google)", url: `https://www.google.com/search?q=site%3Ax.com+OR+site%3Atwitter.com+${quoted}` },
    { label: "Facebook (Google)", url: `https://www.google.com/search?q=site%3Afacebook.com+${quoted}` },
    { label: "Instagram (Google)", url: `https://www.google.com/search?q=site%3Ainstagram.com+${quoted}` },
    { label: "Reddit", url: `https://www.reddit.com/search/?q=${enc}` },
    { label: "GitHub users", url: `https://github.com/search?q=${enc}&type=users` },
    { label: "Wayback", url: `https://web.archive.org/web/*/${enc}` },
  ];
  if (kind === "mail" || kind === "handle") {
    links.push(
      { label: "Epieos", url: `https://epieos.com/?q=${enc}` },
      { label: "IDCrawl", url: `https://www.idcrawl.com/u/${encodeURIComponent(q.replace(/^@/, ""))}` },
    );
  }
  if (kind === "mail") {
    const domain = q.includes("@") ? q.split("@")[1] : "";
    if (domain) {
      links.push({ label: "Hunter domain", url: `https://hunter.io/search/${encodeURIComponent(domain)}` });
    }
  }
  if (kind === "handle") {
    const handle = q.replace(/^@/, "");
    links.push(
      { label: "GitHub profile", url: `https://github.com/${encodeURIComponent(handle)}` },
      { label: "Reddit user", url: `https://www.reddit.com/user/${encodeURIComponent(handle)}` },
    );
  }
  if (kind === "phone") {
    const digits = q.replace(/\D/g, "");
    links.push(
      { label: "Truecaller (public search)", url: `https://www.truecaller.com/search/us/${digits}` },
      { label: "Whitepages (public search)", url: `https://www.whitepages.com/phone/${digits}` },
    );
  }
  if (kind === "host") {
    links.push(
      { label: "crt.sh", url: `https://crt.sh/?q=${enc}` },
      { label: "urlscan", url: `https://urlscan.io/search/#${enc}` },
    );
  }
  return links;
}
