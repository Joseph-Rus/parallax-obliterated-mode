// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import type { ParallaxBridge } from "../preload/bridge";
import {
  THREAD_DETAILS_KEY,
  ThreadDetails,
  ThreadDetailsButton,
  useThreadDetailsOpen,
} from "./ThreadDetails";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let unmount = () => {};
afterEach(() =>
  act(() => {
    unmount();
    document.body.innerHTML = "";
  }),
);
beforeEach(() => {
  localStorage.clear();
  window.parallax = {
    platform: "darwin",
    openTargets: async () => ["cursor", "files"],
    terminalApps: async () => [],
    terminalApp: async () => null,
    openTargetIcons: async () => ({}),
  } as Partial<ParallaxBridge> as ParallaxBridge;
});

function Harness() {
  const [open, toggle] = useThreadDetailsOpen();
  return (
    <>
      <ThreadDetailsButton open={open} onToggle={toggle} />
      <ThreadDetails open={open} hostName="macbook" hostId="local" folder="/repo" />
    </>
  );
}
async function render() {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  unmount = () => root.unmount();
  await act(async () => root.render(<Harness />));
}
const panel = () => document.querySelector<HTMLElement>("aside[aria-label='Thread details']")!;
const button = () => document.querySelector<HTMLButtonElement>("button[aria-controls]")!;

test("the button docks the panel until it's pressed again, and a restart keeps the choice", async () => {
  await render();
  // Mounted while hidden, so its shortcuts still work.
  expect(panel().hidden).toBe(true);
  expect(button().getAttribute("aria-pressed")).toBe("false");

  await act(async () => button().click());
  expect(panel().hidden).toBe(false);
  expect(panel().textContent).toContain("macbook");
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(localStorage.getItem(THREAD_DETAILS_KEY)).toBe("open");
  // A click elsewhere leaves it docked.
  await act(async () => document.body.click());
  expect(panel().hidden).toBe(false);

  await act(async () => unmount());
  await render();
  expect(panel().hidden).toBe(false);

  await act(async () => button().click());
  expect(panel().hidden).toBe(true);
  expect(button().getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem(THREAD_DETAILS_KEY)).toBe("closed");
});
