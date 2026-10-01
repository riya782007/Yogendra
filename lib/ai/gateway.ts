/**
 * lib/ai/gateway.ts — the single internal AI gateway. Requirement 10.
 *
 * EVERY model call in the system goes through here. No UI/route calls a provider
 * directly. The gateway owns: semantic cache, provider chain (primary -> secondary),
 * retry+backoff for transient errors, a circuit breaker for degraded providers,
 * zod schema validation, a budget cap, and structured logging.
 *
 * Final hop is ALWAYS a deterministic fallback, so a caller on a request path can
 * never hang waiting on a live model (also the demo-safety rule, Req 9/Part C).
 *
 * This module is provider-agnostic and pure of network code: providers are injected.
 */
import { z, type ZodType } from "zod";

export type ProviderName = string;

export type GatewayCall<T> = {
  feature: string;
  /** stable cache key for this logical request */
  cacheKey: string;
  /** zod schema the structured output must satisfy */
  schema: ZodType<T>;
  /** estimated cost of this call in paise, charged against the budget */
  estCostPaise?: number;
};

export type Provider<T> = {
  name: ProviderName;
  /** may throw; may return anything — gateway validates against schema */
  run: (call: GatewayCall<T>) => Promise<unknown>;
};

export type AiLog = {
  feature: string;
  provider: ProviderName;
  latencyMs: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  ok: boolean;
  error?: string;
};

export type Cache = {
  get: (key: string) => Promise<unknown | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
};

export type GatewayConfig<T> = {
  primary: Provider<T>;
  secondary?: Provider<T>;
  /** Additional providers, attempted after primary and secondary in order. */
  fallbacks?: Provider<T>[];
  /** deterministic, never-fails fallback — the last hop */
  deterministic: (call: GatewayCall<T>) => T;
  cache?: Cache;
  /** total budget in paise; calls that would exceed it skip to deterministic */
  budgetPaise?: number;
  /** retries for transient errors per provider */
  maxRetries?: number;
  /** base backoff ms (exponential) */
  backoffMs?: number;
  /** consecutive failures before a provider's breaker opens */
  breakerThreshold?: number;
  /** ms the breaker stays open before a half-open trial */
  breakerCooldownMs?: number;
  log?: (entry: AiLog) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const TRANSIENT = /timeout|timed out|429|temporarily|ECONNRESET|ETIMEDOUT|unavailable/i;
function isTransient(err: unknown): boolean {
  return TRANSIENT.test(err instanceof Error ? err.message : String(err));
}

type BreakerState = { failures: number; openedAt: number | null };

export class AiGateway {
  private spentPaise = 0;
  private breakers = new Map<ProviderName, BreakerState>();

  constructor(private cfg: GatewayConfig<any>) {}

  private now() { return (this.cfg.now ?? Date.now)(); }
  private sleep(ms: number) { return (this.cfg.sleep ?? ((m: number) => new Promise((r) => setTimeout(r, m))))(ms); }

  private breaker(name: ProviderName): BreakerState {
    let b = this.breakers.get(name);
    if (!b) { b = { failures: 0, openedAt: null }; this.breakers.set(name, b); }
    return b;
  }

  private breakerOpen(name: ProviderName): boolean {
    const b = this.breaker(name);
    if (b.openedAt == null) return false;
    const cooldown = this.cfg.breakerCooldownMs ?? 30_000;
    if (this.now() - b.openedAt >= cooldown) { b.openedAt = null; b.failures = 0; return false; } // half-open trial
    return true;
  }

  private recordFailure(name: ProviderName) {
    const b = this.breaker(name);
    b.failures++;
    if (b.failures >= (this.cfg.breakerThreshold ?? 3)) b.openedAt = this.now();
  }
  private recordSuccess(name: ProviderName) {
    const b = this.breaker(name);
    b.failures = 0; b.openedAt = null;
  }

  private async tryProvider<T>(p: Provider<T>, call: GatewayCall<T>): Promise<T> {
    const retries = this.cfg.maxRetries ?? 2;
    const base = this.cfg.backoffMs ?? 50;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await p.run(call);
        const parsed = call.schema.safeParse(raw);
        if (!parsed.success) throw new Error("schema validation failed"); // semantic failure -> fall back
        return parsed.data;
      } catch (err) {
        lastErr = err;
        // Retry only transient errors; semantic/schema errors break out to fallback immediately.
        if (isTransient(err) && attempt < retries) { await this.sleep(base * 2 ** attempt); continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  async run<T>(call: GatewayCall<T>): Promise<{ data: T; provider: ProviderName; cacheHit: boolean; fallbackUsed: boolean }> {
    const start = this.now();
    const emit = (e: Partial<AiLog> & { provider: ProviderName; cacheHit: boolean; fallbackUsed: boolean; ok: boolean }) =>
      this.cfg.log?.({ feature: call.feature, latencyMs: this.now() - start, ...e });

    // 1) cache
    if (this.cfg.cache) {
      const hit = await this.cfg.cache.get(call.cacheKey);
      if (hit !== undefined) {
        const parsed = call.schema.safeParse(hit);
        if (parsed.success) {
          emit({ provider: "cache", cacheHit: true, fallbackUsed: false, ok: true });
          return { data: parsed.data, provider: "cache", cacheHit: true, fallbackUsed: false };
        }
      }
    }

    // 2) budget guard -> straight to deterministic if over cap
    const cost = call.estCostPaise ?? 0;
    const overBudget = this.cfg.budgetPaise != null && this.spentPaise + cost > this.cfg.budgetPaise;

    // 3) provider chain
    if (!overBudget) {
      const chain = [this.cfg.primary, this.cfg.secondary, ...(this.cfg.fallbacks ?? [])].filter(Boolean) as Provider<T>[];
      for (const p of chain) {
        if (this.breakerOpen(p.name)) continue;
        try {
          const data = await this.tryProvider(p, call);
          this.recordSuccess(p.name);
          this.spentPaise += cost;
          await this.cfg.cache?.set(call.cacheKey, data);
          emit({ provider: p.name, cacheHit: false, fallbackUsed: p !== this.cfg.primary, ok: true });
          return { data, provider: p.name, cacheHit: false, fallbackUsed: p !== this.cfg.primary };
        } catch (err) {
          this.recordFailure(p.name);
          emit({ provider: p.name, cacheHit: false, fallbackUsed: false, ok: false, error: String(err instanceof Error ? err.message : err) });
          // try next provider
        }
      }
    }

    // 4) deterministic final hop — never throws
    const data = this.cfg.deterministic(call) as T;
    emit({ provider: "deterministic", cacheHit: false, fallbackUsed: true, ok: true });
    return { data, provider: "deterministic", cacheHit: false, fallbackUsed: true };
  }

  get spent(): number { return this.spentPaise; }
}

export { z };
