// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ParallaxBridge } from "../preload/bridge";
import type { UsageLimitWindow } from "../protocol/generated/protocol";
import {
  currentLimit,
  forgetLimits,
  tokenPercent,
  tokensPerSecond,
  UsageRing,
  UsageRow,
  UsageWarning,
  useComposerUsage,
} from "./ComposerUsage";
import { behaviorPrefs, setBehaviorPrefs } from "./prefs";
import type { RequestUsage } from "./transcript";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = Date.parse("2026-10-11T00:00:00Z");
const limit: UsageLimitWindow = {
  window: "five_hour",
  usedPercent: 35,
  capturedAt: new Date(now).toISOString(),
  resetsAt: new Date(now + 60_000).toISOString(),
};
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  forgetLimits();
});
const usage: RequestUsage = {
  kind: "requestUsage",
  backend: "claude",
  accountId: "claude",
  at: new Date(now).toISOString(),
  usage: {
    model: "claude-opus-5-5",
    contextTokens: 50_000,
    contextWindow: 200_000,
    inputTokens: 50_000,
    cachedInputTokens: 25_000,
    outputTokens: 1_780,
    outputMs: 21_513,
  },
};
/** The composer's pieces, as it places them: the ring or the row, and the warning. */
function ComposerUsage({
  view = "row",
  ...props
}: Parameters<typeof useComposerUsage>[0] & { view?: "ring" | "row" }) {
  const data = useComposerUsage(props);
  if (!data) return null;
  return (
    <>
      {view === "ring" ? <UsageRing data={data} /> : <UsageRow data={data} />}
      {data.warning && <UsageWarning text={data.warning} />}
    </>
  );
}
const render = async (
  backend = "claude",
  accountId = backend,
  measured = usage,
  connected = true,
  kind: string | undefined = backend,
) => {
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <ComposerUsage
        hostId="local"
        connected={connected}
        backend={backend}
        accountId={accountId}
        kind={kind}
        usage={measured}
      />,
    ),
  );
};

test("missing, expired, stale, and malformed limits never become zero", () => {
  expect(currentLimit(limit, now)).toBe(35);
  expect(currentLimit({ ...limit, usedPercent: 0 }, now)).toBe(0);
  for (const patch of [
    { usedPercent: undefined },
    { usedPercent: NaN },
    { usedPercent: -1 },
    { usedPercent: 101 },
    { resetsAt: new Date(now).toISOString() },
    { resetsAt: "bad" },
    { capturedAt: new Date(now - 90_001).toISOString() },
    { capturedAt: "bad" },
  ])
    expect(currentLimit({ ...limit, ...patch }, now)).toBeUndefined();
});
test("token ratios validate denominators and preserve zero and tiny percentages", () => {
  expect(tokenPercent(0, 100)).toBe("0%");
  expect(tokenPercent(1, 1000)).toBe("<1%");
  expect(tokenPercent(36458, 36809)).toBe("99%");
  for (const [a, b] of [
    [undefined, 100],
    [0, 0],
    [-1, 100],
    [101, 100],
    [NaN, 100],
  ])
    expect(tokenPercent(a, b)).toBeUndefined();
});
test("shows live account meters and request ratios, and expires after reset", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  expect(document.body.textContent).toContain("5h35%");
  expect(document.body.textContent).toContain("25% context");
  expect(document.body.textContent).toContain("50% cached");
  expect(document.body.textContent).toContain("~83 tok/s");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(document.body.textContent).toContain("5h—");
  expect(request).toHaveBeenCalledTimes(2);
});
test("provider switch, API key fallback and disconnect cannot display another account's data", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  await render("codex");
  expect(document.body.textContent).toContain("Limits unavailable");
  expect(document.body.textContent).toContain("— context");
  await render("claude", "key-account");
  expect(document.body.textContent).toContain("Limits unavailable");
  expect(document.body.textContent).toContain("— cached");
  expect(request).toHaveBeenCalledTimes(1);
  await render("claude", "claude", usage, false);
  expect(document.body.textContent).toContain("— context");
});
test("older daemon or refresh failure clears unavailable limits", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi
    .fn()
    .mockResolvedValueOnce({ result: { accounts: [{ accountId: "claude", limits: [limit] }] } })
    .mockResolvedValue({ error: { code: -32601, message: "Method not found" } });
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  expect(document.body.textContent).toContain("5h35%");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(document.body.textContent).toContain("Limits unavailable");
});
test("output speed needs both sides and a provider whose timing it understands", async () => {
  expect(tokensPerSecond(1_780, 21_513)).toBe(83);
  for (const [tokens, ms] of [
    [undefined, 1_000],
    [100, undefined],
    [0, 1_000],
    [100, 0],
    [NaN, 1_000],
  ])
    expect(tokensPerSecond(tokens, ms)).toBeUndefined();
  window.parallax = {
    request: vi.fn(async () => ({ result: { accounts: [] } })),
  } as unknown as ParallaxBridge;
  // A Codex or ACP sample would have no known timing source, so it stays unknown.
  const codex = { ...usage, backend: "codex", accountId: "codex" };
  await render("codex", "codex", codex, true, "codex");
  expect(document.body.textContent).toContain("— tok/s");
  await render("claude", "claude", { ...usage, usage: { ...usage.usage, outputMs: undefined } });
  expect(document.body.textContent).toContain("— tok/s");
});
test("strips on one host share a minute's read of the limits", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  // A strip remounted, as switching threads does, reuses the answer.
  act(() => root?.unmount());
  root = undefined;
  await render();
  expect(document.body.textContent).toContain("5h35%");
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(request).toHaveBeenCalledTimes(2);
});
test("the ring fills with context, tints by the fullest meter, and opens a card that pins the row", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const near = { ...limit, usedPercent: 92 };
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "claude", limits: [near] }] },
    })),
  } as unknown as ParallaxBridge;
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <ComposerUsage
        view="ring"
        hostId="local"
        connected
        backend="claude"
        kind="claude"
        accountId="claude"
        usage={usage}
      />,
    ),
  );
  const ring = document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(ring.getAttribute("aria-label")).toBe("Usage: 25% context, 5h 92%");
  expect(ring.className).toContain("text-danger");
  const card = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(card.hidden).toBe(true);
  await act(async () => ring.click());
  expect(card.hidden).toBe(false);
  expect(card.textContent).toContain("50K / 200K · 25%");
  expect(card.textContent).toContain("~83 tok/s");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("5-hour limit 92% used");
  const before = behaviorPrefs.get().composerUsage;
  await act(async () => card.querySelector<HTMLElement>('[role="switch"]')!.click());
  expect(behaviorPrefs.get().composerUsage).toBe("row");
  setBehaviorPrefs({ composerUsage: before });
});
