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
  UsageInline,
  UsageRing,
  useComposerUsage,
} from "./ComposerUsage";
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
/** The ring, as the composer places it. */
function ComposerUsage(props: Parameters<typeof useComposerUsage>[0]) {
  const data = useComposerUsage(props);
  return data ? <UsageRing data={data} /> : null;
}
/** What the ring says, without its "Usage: " prefix, or nothing when it's hidden. */
const line = () =>
  document
    .querySelector("button[aria-expanded]")
    ?.getAttribute("aria-label")
    ?.replace(/^Usage: /, "");
const card = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Usage"]')!;
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
test("shows the fullest window in the tray, every measurement in its card, and expires after reset", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const week = {
    ...limit,
    window: "seven_day",
    usedPercent: 20,
    resetsAt: new Date(now + 86_400_000 * 3).toISOString(),
  };
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit, week] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  expect(line()).toBe("35% of 5h used");
  expect(card().textContent).toContain("5h35%");
  expect(card().textContent).toContain("Week20%");
  expect(card().textContent).toContain("50K / 200K · 25%");
  expect(card().textContent).toContain("Cached input50%");
  expect(card().textContent).toContain("~83 tok/s");
  // Past its reset, the 5-hour reading is no longer current, so the week speaks instead.
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(line()).toBe("20% of week used");
  // Its reset time has passed, so the row shows neither the percent nor that time.
  expect(card().textContent).toMatch(/5h—Week/);
  expect(request).toHaveBeenCalledTimes(2);
});
test("a used-up window says when it comes back, and nearly full ones change tone", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      result: { accounts: [{ accountId: "claude", limits: [{ ...limit, usedPercent: 100 }] }] },
    })
    .mockResolvedValue({
      result: { accounts: [{ accountId: "claude", limits: [{ ...limit, usedPercent: 92 }] }] },
    });
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  const item = () => document.querySelector("button[aria-expanded]")!;
  expect(line()).toMatch(/^5-hour limit used up, back /);
  expect(item().className).toContain("text-danger");
  forgetLimits();
  act(() => root?.unmount());
  root = undefined;
  await render();
  expect(line()).toBe("92% of 5h used");
  expect(item().className).toContain("text-danger");
});
test("provider switch, API key fallback and disconnect cannot display another account's data", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  // Codex has no windows here and the measurements are Claude's: nothing to say.
  await render("codex");
  expect(line()).toBeUndefined();
  // An API key account reads no limits, but its own measurements still count.
  await render("claude", "key-account", { ...usage, accountId: "key-account" });
  expect(line()).toBe("25% of context used");
  expect(card().textContent).toContain("Limits unavailable");
  expect(request).toHaveBeenCalledTimes(1);
  await render("claude", "claude", usage, false);
  expect(line()).toBeUndefined();
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
  expect(line()).toBe("35% of 5h used");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(line()).toBe("25% of context used");
  expect(card().textContent).toContain("Limits unavailable");
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
  // A Codex or ACP sample would have no known timing source, so it isn't shown.
  const codex = { ...usage, backend: "codex", accountId: "codex" };
  await render("codex", "codex", codex, true, "codex");
  expect(card().textContent).not.toContain("tok/s");
  await render("claude", "claude", { ...usage, usage: { ...usage.usage, outputMs: undefined } });
  expect(card().textContent).not.toContain("tok/s");
  expect(card().textContent).toContain("Cached input50%");
});
test("composers on one host share a minute's read of the limits", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const request = vi.fn(async () => ({
    result: { accounts: [{ accountId: "claude", limits: [limit] }] },
  }));
  window.parallax = { request } as unknown as ParallaxBridge;
  await render();
  // Remounted, as switching threads does, it reuses the answer.
  act(() => root?.unmount());
  root = undefined;
  await render();
  expect(line()).toBe("35% of 5h used");
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(request).toHaveBeenCalledTimes(2);
});
test("hover peeks at the card, a click keeps it open, and Escape closes it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "claude", limits: [limit] }] },
    })),
  } as unknown as ParallaxBridge;
  await render();
  const item = document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  const wrapper = item.parentElement!;
  expect(card().hidden).toBe(true);
  await act(async () => wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(card().hidden).toBe(false);
  expect(item.getAttribute("aria-expanded")).toBe("true");
  await act(async () => item.click());
  await act(async () => wrapper.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(200));
  expect(card().hidden).toBe(false);
  await act(async () =>
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(card().hidden).toBe(true);
  // Without a click, leaving closes it after the short delay.
  await act(async () => wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await act(async () => wrapper.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(200));
  expect(card().hidden).toBe(true);
});
test("a used-up window with no reset time outranks one that resets, since it may keep you waiting", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const capped = { ...limit, usedPercent: 100 };
  const week = { window: "seven_day", usedPercent: 100, capturedAt: limit.capturedAt };
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "claude", limits: [capped, week] }] },
    })),
  } as unknown as ParallaxBridge;
  await render();
  expect(line()).toBe("Weekly limit used up");
});
test("focus leaving closes a card a click kept open", async () => {
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "claude", limits: [limit] }] },
    })),
  } as unknown as ParallaxBridge;
  await render();
  const item = document.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  await act(async () => item.click());
  expect(card().hidden).toBe(false);
  const outside = document.body.appendChild(document.createElement("button"));
  await act(async () =>
    item.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside })),
  );
  expect(card().hidden).toBe(true);
});
test("the inline row shows each window, says when a used-up one is back, and only reported measurements", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const week = {
    ...limit,
    window: "seven_day",
    usedPercent: 100,
    resetsAt: new Date(now + 3_600_000).toISOString(),
  };
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "claude", limits: [limit, week] }] },
    })),
  } as unknown as ParallaxBridge;
  const Inline = (props: Parameters<typeof useComposerUsage>[0]) => {
    const data = useComposerUsage(props);
    return data ? <UsageInline data={data} /> : null;
  };
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  const show = (measured?: RequestUsage) =>
    act(async () =>
      root!.render(
        <Inline
          hostId="local"
          connected
          backend="codex"
          kind="codex"
          accountId="codex"
          usage={measured}
        />,
      ),
    );
  // Codex: windows from its account, and no timing, so no speed.
  window.parallax = {
    request: vi.fn(async () => ({
      result: { accounts: [{ accountId: "codex", limits: [limit, week] }] },
    })),
  } as unknown as ParallaxBridge;
  await show({ ...usage, backend: "codex", accountId: "codex" });
  const row = document.querySelector('[role="group"][aria-label="Usage"]')!;
  expect(row.textContent).toContain("5h35%");
  expect(row.textContent).toMatch(/Weekback \d/);
  expect(row.textContent).toContain("25% context·50% cached");
  expect(row.textContent).not.toContain("tok/s");
  // Nothing reported: no row at all.
  forgetLimits();
  window.parallax = {
    request: vi.fn(async () => ({ result: { accounts: [] } })),
  } as unknown as ParallaxBridge;
  act(() => root?.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await show();
  expect(document.querySelector('[role="group"][aria-label="Usage"]')).toBeNull();
});
