import pLimit from "p-limit";
import { killImpersonateChildren } from "./curl-impersonate.ts";
import { ScanAbortError, isHardMemoryPressure } from "./memory.ts";

export interface PoolOptions {
  global: number;
  perHost: number;
}

export class HostPool {
  private readonly global: ReturnType<typeof pLimit>;
  private readonly hosts = new Map<string, ReturnType<typeof pLimit>>();
  private readonly perHost: number;
  private aborted = false;
  private abortReason = "";

  constructor(opts: PoolOptions) {
    this.global = pLimit(Math.max(1, opts.global));
    this.perHost = Math.max(1, opts.perHost);
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  get abortedReason(): string {
    return this.abortReason;
  }

  abort(reason = "aborted"): void {
    this.aborted = true;
    this.abortReason = reason;
    killImpersonateChildren();
  }

  throwIfAborted(): void {
    if (this.aborted) {
      throw new ScanAbortError(this.abortReason || "Scan aborted");
    }
  }

  private limiterFor(host: string) {
    let lim = this.hosts.get(host);
    if (!lim) {
      lim = pLimit(this.perHost);
      this.hosts.set(host, lim);
    }
    return lim;
  }

  schedule<T>(host: string, fn: () => Promise<T>): Promise<T | undefined> {
    const hostLim = this.limiterFor(host);
    return this.global(() =>
      hostLim(async () => {
        if (this.aborted) return undefined;
        if (isHardMemoryPressure()) {
          this.abort("memory pressure");
          return undefined;
        }
        return fn();
      }),
    );
  }
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
