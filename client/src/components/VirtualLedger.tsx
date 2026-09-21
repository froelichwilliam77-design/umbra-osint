import { useEffect, useRef, useState, type ReactNode } from "react";
import { LEDGER_OVERSCAN, LEDGER_ROW_HEIGHT, ledgerWindow } from "@shared/scan-limits";
import type { LedgerRow } from "@shared/types";
import { Badge } from "@/components/ui/badge";

export function VirtualLedger({
  items,
  selectedId,
  empty,
  onOpen,
}: {
  items: LedgerRow[];
  selectedId?: string;
  empty: ReactNode;
  onOpen: (row: LedgerRow) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight || 420);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) {
    return <div className="max-h-[62vh] overflow-auto">{empty}</div>;
  }

  const win = ledgerWindow({
    scrollTop,
    viewportHeight: height,
    rowHeight: LEDGER_ROW_HEIGHT,
    count: items.length,
    overscan: LEDGER_OVERSCAN,
  });
  const slice = items.slice(win.start, win.end);

  return (
    <div
      ref={scrollerRef}
      className="max-h-[62vh] overflow-auto"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: win.totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${win.offset}px)` }}>
          {slice.map((row) => (
            <button
              key={row.id}
              onClick={() => onOpen(row)}
              style={{ minHeight: LEDGER_ROW_HEIGHT }}
              className={`ledger-row flex w-full items-start gap-3 border-b border-ink-700 px-3 py-2 text-left ${
                selectedId === row.id ? "bg-accent/10" : ""
              }`}
            >
              {row.metadata?.avatarUrl ? (
                <img
                  src={row.metadata.avatarUrl}
                  alt=""
                  className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-ink-600 object-cover"
                />
              ) : (
                <Badge tone={row.status}>{row.status}</Badge>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{row.site}</span>
                  {row.metadata?.avatarUrl && <Badge tone={row.status}>{row.status}</Badge>}
                  {row.variant && (
                    <span className="shrink-0 rounded border border-accent/40 px-1 font-mono text-[10px] text-accent">
                      {row.variant}
                    </span>
                  )}
                  {row.confidence === "high" && row.status === "found" && (
                    <span className="hidden shrink-0 font-mono text-[10px] text-signal-found sm:inline">high</span>
                  )}
                  <span className="font-mono text-[10px] text-fog-500">{row.category}</span>
                  {row.metadata?.displayName && (
                    <span className="hidden truncate text-xs text-fog-300 sm:inline">
                      {row.metadata.displayName}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[11px] text-fog-500">{row.profileUrl || row.url}</div>
                <div className="truncate text-[11px] text-fog-500">{row.reason}</div>
              </div>
              <span className="hidden shrink-0 font-mono text-[10px] text-fog-500 md:inline">
                {row.httpStatus ?? "—"} · {row.latencyMs ?? "—"}ms
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
