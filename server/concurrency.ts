import pLimit from "p-limit";

export interface PoolOptions {
  global: number;
  perHost: number;
}

export class HostPool {
  private readonly global: ReturnType<typeof pLimit>;
  private readonly hosts = new Map<string, ReturnType<typeof pLimit>>();
  private readonly perHost: number;

  constructor(opts: PoolOptions) {
    this.global = pLimit(Math.max(1, opts.global));
    this.perHost = Math.max(1, opts.perHost);
  }

  private limiterFor(host: string) {
    let lim = this.hosts.get(host);
    if (!lim) {
      lim = pLimit(this.perHost);
      this.hosts.set(host, lim);
    }
    return lim;
  }

  schedule<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const hostLim = this.limiterFor(host);
    return this.global(() => hostLim(fn));
  }
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
