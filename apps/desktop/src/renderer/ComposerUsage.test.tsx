// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { ParallaxBridge } from "../preload/bridge";
import type { UsageLimitWindow } from "../protocol/generated/protocol";
import { ComposerUsage, currentLimit, tokenPercent } from "./ComposerUsage";
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
  },
};
const render = async (
  backend = "claude",
  accountId = backend,
  measured = usage,
  connected = true,
) => {
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <ComposerUsage
        key={`${backend}/${accountId}`}
        hostId="local"
        connected={connected}
        backend={backend}
        accountId={accountId}
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
  expect(document.body.textContent).toContain("— tok/s");
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
