import { describe, it, expect, vi } from "vitest";
import { AiGateway, z, type Provider, type GatewayCall } from "../lib/ai/gateway";

const schema = z.object({ title: z.string() });
type Out = { title: string };

const call: GatewayCall<Out> = {
  feature: "listing",
  cacheKey: "p1",
  schema,
  estCostPaise: 10,
};

const det = () => ({ title: "TEMPLATE TITLE" });

function provider(name: string, impl: () => Promise<unknown>): Provider<Out> {
  return { name, run: impl };
}

describe("AiGateway", () => {
  it("returns primary result when it succeeds", async () => {
    const g = new AiGateway({ primary: provider("p", async () => ({ title: "AI" })), deterministic: det });
    const r = await g.run(call);
    expect(r.data.title).toBe("AI");
    expect(r.provider).toBe("p");
    expect(r.fallbackUsed).toBe(false);
  });

  it("falls back to secondary when primary throws", async () => {
    const g = new AiGateway({
      primary: provider("p", async () => { throw new Error("boom"); }),
      secondary: provider("s", async () => ({ title: "FROM SECONDARY" })),
      deterministic: det,
    });
    const r = await g.run(call);
    expect(r.data.title).toBe("FROM SECONDARY");
    expect(r.provider).toBe("s");
  });

  it("tries additional fallbacks in order before deterministic output", async () => {
    const third = vi.fn(async () => ({ title: "FROM THIRD" }));
    const g = new AiGateway({
      primary: provider("p", async () => { throw new Error("boom"); }),
      secondary: provider("s", async () => { throw new Error("boom2"); }),
      fallbacks: [provider("third", third)],
      deterministic: det,
    });
    const r = await g.run(call);
    expect(r.data.title).toBe("FROM THIRD");
    expect(r.provider).toBe("third");
    expect(r.fallbackUsed).toBe(true);
  });

  it("falls back to deterministic when all providers fail", async () => {
    const g = new AiGateway({
      primary: provider("p", async () => { throw new Error("boom"); }),
      secondary: provider("s", async () => { throw new Error("boom2"); }),
      deterministic: det,
    });
    const r = await g.run(call);
    expect(r.data.title).toBe("TEMPLATE TITLE");
    expect(r.provider).toBe("deterministic");
    expect(r.fallbackUsed).toBe(true);
  });

  it("falls back to deterministic on schema-invalid output (semantic failure, no retry)", async () => {
    const run = vi.fn(async () => ({ wrong: "shape" }));
    const g = new AiGateway({ primary: provider("p", run), deterministic: det, maxRetries: 2 });
    const r = await g.run(call);
    expect(r.provider).toBe("deterministic");
    expect(run).toHaveBeenCalledTimes(1); // schema error is NOT retried
  });

  it("retries transient errors with backoff then succeeds", async () => {
    let n = 0;
    const run = vi.fn(async () => { n++; if (n < 3) throw new Error("timeout"); return { title: "OK" }; });
    const g = new AiGateway({ primary: provider("p", run), deterministic: det, maxRetries: 3, sleep: async () => {} });
    const r = await g.run(call);
    expect(r.data.title).toBe("OK");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("opens circuit breaker after threshold and skips the provider", async () => {
    const run = vi.fn(async () => { throw new Error("hard fail"); });
    const g = new AiGateway({
      primary: provider("p", run), deterministic: det,
      maxRetries: 0, breakerThreshold: 2, breakerCooldownMs: 10_000, now: () => 1000,
    });
    await g.run(call); // failure 1
    await g.run(call); // failure 2 -> breaker opens
    const callsAfterOpen = run.mock.calls.length;
    await g.run(call); // breaker open -> provider skipped
    expect(run.mock.calls.length).toBe(callsAfterOpen);
  });

  it("uses cache on hit without calling providers", async () => {
    const store = new Map<string, unknown>([["p1", { title: "CACHED" }]]);
    const run = vi.fn(async () => ({ title: "AI" }));
    const g = new AiGateway({
      primary: provider("p", run), deterministic: det,
      cache: { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } },
    });
    const r = await g.run(call);
    expect(r.data.title).toBe("CACHED");
    expect(r.cacheHit).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("skips providers and uses deterministic when over budget", async () => {
    const run = vi.fn(async () => ({ title: "AI" }));
    const g = new AiGateway({ primary: provider("p", run), deterministic: det, budgetPaise: 5 });
    const r = await g.run(call); // estCost 10 > budget 5
    expect(r.provider).toBe("deterministic");
    expect(run).not.toHaveBeenCalled();
  });

  it("logs every call", async () => {
    const log = vi.fn();
    const g = new AiGateway({ primary: provider("p", async () => ({ title: "AI" })), deterministic: det, log });
    await g.run(call);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ feature: "listing", provider: "p", ok: true });
  });
});
