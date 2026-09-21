import type { AvatarCluster } from "@shared/types";

function reverseLinks(imageUrl: string) {
  const enc = encodeURIComponent(imageUrl);
  return [
    { engine: "Lens", url: `https://lens.google.com/uploadbyurl?url=${enc}` },
    { engine: "Yandex", url: `https://yandex.com/images/search?rpt=imageview&url=${enc}` },
    { engine: "TinEye", url: `https://tineye.com/search?url=${enc}` },
  ];
}

export function AvatarClustersPanel({ clusters }: { clusters?: AvatarCluster[] | null }) {
  if (!clusters?.length) return null;
  return (
    <section className="mt-4 rounded-xl border border-ink-600 bg-ink-900/70 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-fog-300">
        Avatar pHash clusters · {clusters.length}
      </div>
      <p className="mb-3 text-sm text-fog-300">
        Near-identical avatars across sites (Hamming ≤ 10). Same face/logo often means the same operator.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {clusters.map((c) => {
          const members = c.members?.length
            ? c.members
            : c.sites.map((site, i) => ({ site, url: "", avatarUrl: c.avatarUrls[i] ?? c.avatarUrls[0] ?? "" }));
          return (
            <div key={c.phash} className="rounded-lg border border-ink-700 bg-ink-950 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px] text-fog-500">
                <span>
                  {members.length} avatars · dist ≤ {c.distanceMax}
                </span>
                <span className="truncate">{c.phash.slice(0, 16)}…</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {members.slice(0, 8).map((m) => (
                  <a
                    key={`${m.site}-${m.avatarUrl}`}
                    href={m.url || m.avatarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-20 flex-col items-center gap-1"
                  >
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt=""
                        className="h-16 w-16 rounded-full border border-ink-600 object-cover"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full border border-ink-600 bg-ink-800" />
                    )}
                    <span className="w-full truncate text-center font-mono text-[10px] text-fog-100">{m.site}</span>
                    {m.avatarUrl && (
                      <span className="flex flex-wrap justify-center gap-1">
                        {reverseLinks(m.avatarUrl).map((l) => (
                          <a
                            key={l.engine}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[9px] text-accent hover:underline"
                          >
                            {l.engine}
                          </a>
                        ))}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
