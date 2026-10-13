// @vitest-environment happy-dom
import cursorIcon from "./assets/cursor.svg";
import ghosttyIcon from "./assets/ghostty.svg";
import vscodeIcon from "./assets/vscode.svg";
import alacrittyIcon from "./assets/alacritty.svg";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { ParallaxBridge } from "../preload/bridge";
import { OPEN_TARGET_KEY, OpenMenu } from "./OpenMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
HTMLElement.prototype.hidePopover = () => {};
let unmount = () => {};
afterEach(() =>
  act(() => {
    unmount();
    document.body.innerHTML = "";
  }),
);
const openFolder = vi.fn();
const selectTerminalApp = vi.fn();
beforeEach(() => {
  localStorage.clear();
  openFolder.mockClear();
  selectTerminalApp.mockClear();
  let chosen = "Ghostty";
  window.parallax = {
    platform: "darwin",
    openFolder,
    openTargets: async () => ["cursor", "vscode", "files", "terminal"],
    terminalApps: async () => [
      { path: "/Applications/Ghostty.app", name: "Ghostty" },
      { path: "/System/Applications/Utilities/Terminal.app", name: "Terminal" },
    ],
    terminalApp: async () => chosen,
    selectTerminalApp: selectTerminalApp.mockImplementation(
      async (path: string) => (chosen = path.includes("Ghostty") ? "Ghostty" : "Terminal"),
    ),
    openTargetIcons: async () => ({ cursor: "data:image/png;base64,Y3Vyc29y" }),
  } as Partial<ParallaxBridge> as ParallaxBridge;
});
async function render(hostId = "local", folder: string | undefined = "/repo") {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  unmount = () => root.unmount();
  await act(async () => root.render(<OpenMenu hostId={hostId} folder={folder} />));
}
const menu = (label: string) => document.querySelector(`[role="menu"][aria-label="${label}"]`)!;
const item = (label: string, name: string) =>
  [...menu(label).querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(name),
  )!;
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  )!;

test("editor and terminal selectors are separate, and selection preserves the other preference", async () => {
  await render();
  expect(document.querySelector('[aria-label="Open in Cursor"] img')?.getAttribute("src")).toBe(
    cursorIcon,
  );
  expect(
    [...menu("Open in").querySelectorAll("span.flex-1")].map((span) => span.textContent),
  ).toEqual(["Cursor", "VS Code", "Finder"]);
  expect(
    [...menu("Terminals").querySelectorAll("span.flex-1")].map((span) => span.textContent),
  ).toEqual(["Ghostty", "Terminal"]);
  expect(item("Terminals", "Ghostty").getAttribute("aria-checked")).toBe("true");
  expect(item("Terminals", "Terminal").getAttribute("aria-checked")).toBe("false");
  await act(async () => item("Open in", "VS Code").click());
  expect(localStorage.getItem(OPEN_TARGET_KEY)).toBe("vscode");
  expect(button("Open in Ghostty")).toBeDefined();
  await act(async () => item("Terminals", "Terminal").click());
  expect(selectTerminalApp).toHaveBeenCalledWith("/System/Applications/Utilities/Terminal.app");
  expect(button("Open in Terminal")).toBeDefined();
  expect(item("Terminals", "Terminal").getAttribute("aria-checked")).toBe("true");
  expect(localStorage.getItem(OPEN_TARGET_KEY)).toBe("vscode");
  await act(async () => button("Open in Terminal").click());
  expect(openFolder).toHaveBeenLastCalledWith("local", "terminal", "/repo");
});

test("Open shortcut keeps the editor choice even with the panel closed", async () => {
  localStorage.setItem(OPEN_TARGET_KEY, "terminal");
  await render();
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyO", key: "o", metaKey: true, altKey: true }),
    ),
  );
  expect(openFolder).toHaveBeenCalledWith("local", "cursor", "/repo");
});

test("remote terminal launch and selection explain why they are disabled", async () => {
  await render("ssh-host");
  expect(button("Open in Ghostty").disabled).toBe(true);
  expect(button("Open in Ghostty").title).toBe("Terminals open folders on this computer only");
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Choose terminal"]')!.disabled,
  ).toBe(true);
});

test("supplied editor and terminal SVGs take priority while Finder and Terminal retain system icons", async () => {
  window.parallax.openTargetIcons = async () => ({
    files: "finder-system-icon",
    terminal: "terminal-system-icon",
    vscode: "old-raster",
  });
  window.parallax.terminalApps = async () => [
    { path: "/Applications/Ghostty.app", name: "Ghostty" },
    { path: "/Applications/Alacritty.app", name: "Alacritty" },
    { path: "/System/Applications/Utilities/Terminal.app", name: "Terminal" },
  ];
  await render();
  expect(item("Open in", "VS Code").querySelector("img")?.getAttribute("src")).toBe(vscodeIcon);
  expect(item("Open in", "Finder").querySelector("img")?.getAttribute("src")).toBe(
    "finder-system-icon",
  );
  expect(item("Terminals", "Ghostty").querySelector("img")?.getAttribute("src")).toBe(ghosttyIcon);
  expect(item("Terminals", "Alacritty").querySelector("img")?.getAttribute("src")).toBe(
    alacrittyIcon,
  );
  await act(async () => item("Terminals", "Terminal").click());
  expect(button("Open in Terminal").querySelector("img")?.getAttribute("src")).toBe(
    "terminal-system-icon",
  );
});
