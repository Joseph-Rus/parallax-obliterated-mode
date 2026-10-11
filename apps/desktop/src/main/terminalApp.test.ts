import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vite-plus/test";

import {
  detectTerminalApps,
  readTerminalApp,
  terminalCommand,
  terminalName,
  writeTerminalApp,
} from "./terminalApp";

test("the chosen terminal is saved and read back, and a bad file reads as none", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "terminal-")), "terminal.json");
  expect(readTerminalApp(file)).toBeUndefined();
  writeTerminalApp(file, "/Applications/Ghostty.app");
  expect(readTerminalApp(file)).toBe("/Applications/Ghostty.app");
  writeFileSync(file, '{"app":"relative/Ghostty.app"}');
  expect(readTerminalApp(file)).toBeUndefined();
});

test("macOS opens the folder with open -a, elsewhere the app starts in it", () => {
  expect(terminalName("/Applications/iTerm.app")).toBe("iTerm");
  expect(terminalName("C:\\Program Files\\WezTerm\\wezterm-gui.exe")).toBe("wezterm-gui");
  expect(terminalCommand("darwin", "/Applications/iTerm.app", "/Users/me/repo")).toEqual({
    file: "/usr/bin/open",
    args: ["-a", "/Applications/iTerm.app", "/Users/me/repo"],
  });
  expect(terminalCommand("linux", "/usr/bin/kitty", "/home/me/repo")).toEqual({
    file: "/usr/bin/kitty",
    args: [],
    cwd: "/home/me/repo",
  });
});

test("detects only known installed terminals and preserves a recognized saved app", () => {
  const saved = "/custom/kitty.app";
  const installed = new Set([
    "/Applications/Ghostty.app",
    "/System/Applications/Utilities/Terminal.app",
    saved,
    "/Applications/Cursor.app",
  ]);
  expect(detectTerminalApps("darwin", {}, saved, (file) => installed.has(file))).toEqual([
    { path: "/Applications/Ghostty.app", name: "Ghostty" },
    { path: "/System/Applications/Utilities/Terminal.app", name: "Terminal" },
    { path: saved, name: "kitty" },
  ]);
  expect(
    detectTerminalApps("darwin", {}, "/Applications/Cursor.app", (file) =>
      installed.has(file),
    ).some((app) => app.path.includes("Cursor")),
  ).toBe(false);
});

test("finds Linux and Windows terminals on their platform paths", () => {
  expect(
    detectTerminalApps(
      "linux",
      { PATH: "/bin:/usr/bin" },
      undefined,
      (file) => file === "/usr/bin/kitty",
    ),
  ).toEqual([{ path: "/usr/bin/kitty", name: "kitty" }]);
  expect(
    detectTerminalApps(
      "win32",
      { LOCALAPPDATA: "C:\\Users\\ryan\\AppData\\Local" },
      undefined,
      (file) => file.endsWith("\\wt.exe"),
    ),
  ).toEqual([
    {
      path: "C:\\Users\\ryan\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
      name: "Windows Terminal",
    },
  ]);
});
