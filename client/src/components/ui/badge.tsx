import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  found: "bg-signal-found/12 text-signal-found border-signal-found/25",
  miss: "bg-white/5 text-fog-300 border-white/10",
  blocked: "bg-signal-blocked/12 text-signal-blocked border-signal-blocked/25",
  escalate: "bg-signal-escalate/12 text-signal-escalate border-signal-escalate/25",
  error: "bg-signal-error/12 text-signal-error border-signal-error/25",
  invalid: "bg-white/5 text-signal-invalid border-white/10",
  muted: "bg-ink-700 text-fog-300 border-ink-600",
};

export function Badge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof tones | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        tones[tone] ?? tones.muted,
        className,
      )}
    >
      {children}
    </span>
  );
}
