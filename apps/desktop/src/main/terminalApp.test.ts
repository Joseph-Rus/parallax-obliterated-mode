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
    args: ["--directory", "/home/me/repo"],
    cwd: "/home/me/repo",
  });
  expect(terminalCommand("linux", "/usr/bin/xterm", "/home/me/repo")).toEqual({
    file: "/usr/bin/xterm",
    args: [],
    cwd: "/home/me/repo",
  });
});

test("each known terminal is told the folder, since some ignore where they start", () => {
  const folder = "C:\\Users\\me\\repo";
  const wt = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe";
  expect(terminalCommand("win32", wt, folder)).toEqual({
    file: wt,
    args: ["-d", folder],
    cwd: folder,
  });
  expect(
    terminalCommand("win32", "C:\\Program Files\\WezTerm\\wezterm-gui.exe", folder).args,
  ).toEqual(["start", "--cwd", folder]);
  expect(
    terminalCommand("win32", "C:\\Program Files\\Alacritty\\alacritty.exe", folder).args,
  ).toEqual(["--working-directory", folder]);
  const home = "/home/me/repo";
  expect(terminalCommand("linux", "/usr/bin/gnome-terminal", home).args).toEqual([
    `--working-directory=${home}`,
  ]);
  expect(terminalCommand("linux", "/usr/bin/konsole", home).args).toEqual(["--workdir", home]);
  expect(terminalCommand("linux", "/usr/bin/wezterm", home).args).toEqual(["start", "--cwd", home]);
  expect(terminalCommand("linux", "/usr/bin/ghostty", home).args).toEqual([
    `--working-directory=${home}`,
  ]);
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
