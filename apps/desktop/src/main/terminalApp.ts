import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { TerminalApp } from "../preload/bridge";

/**
 * The terminal app the Open menu opens a folder in, chosen in Settings > General: its path, kept
 * in `file` as `{ "app": path }`. Undefined until chosen, or when the file can't be read.
 */
export function readTerminalApp(file: string): string | undefined {
  try {
    const { app } = JSON.parse(readFileSync(file, "utf8")) as { app?: unknown };
    return typeof app === "string" && path.isAbsolute(app) ? app : undefined;
  } catch {
    return undefined;
  }
}

export const writeTerminalApp = (file: string, app: string): void =>
  writeFileSync(file, `${JSON.stringify({ app })}\n`);

/** The app's name for people: its file name without `.app` or `.exe`, from any OS's path. */
export const terminalName = (app: string): string =>
  path.win32.basename(app).replace(/\.(app|exe)$/i, "");

/**
 * The command that opens `folder` in terminal `app`. macOS hands the folder to the app with
 * `open -a`, which every terminal there takes as where to start. Elsewhere the app starts in it.
 */
export function terminalCommand(
  platform: NodeJS.Platform,
  app: string,
  folder: string,
): { file: string; args: string[]; cwd?: string } {
  return platform === "darwin"
    ? { file: "/usr/bin/open", args: ["-a", app, folder] }
    : { file: app, args: [], cwd: folder };
}

/** Known terminal apps only, found in the platform's app folders and PATH. */
export function detectTerminalApps(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  saved?: string,
  exists: (file: string) => boolean = existsSync,
): TerminalApp[] {
  const p = platform === "win32" ? path.win32 : path.posix;
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(p.delimiter).filter(Boolean);
  const names =
    platform === "darwin"
      ? [
          "Ghostty.app",
          "iTerm.app",
          "Terminal.app",
          "WezTerm.app",
          "Alacritty.app",
          "kitty.app",
          "Warp.app",
        ]
      : platform === "win32"
        ? ["wt.exe", "wezterm-gui.exe", "alacritty.exe", "WindowsTerminal.exe"]
        : [
            "ghostty",
            "kitty",
            "wezterm",
            "alacritty",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "xterm",
          ];
  const apps: TerminalApp[] = [];
  for (const name of names) {
    const locations =
      platform === "darwin"
        ? [
            "/Applications",
            "/System/Applications/Utilities",
            ...(env["HOME"] ? [p.join(env["HOME"], "Applications")] : []),
          ]
        : platform === "win32"
          ? [
              ...dirs,
              ...(env["LOCALAPPDATA"]
                ? [p.join(env["LOCALAPPDATA"], "Microsoft", "WindowsApps")]
                : []),
              ...(env["ProgramFiles"]
                ? [p.join(env["ProgramFiles"], "WezTerm"), p.join(env["ProgramFiles"], "Alacritty")]
                : []),
            ]
          : dirs;
    const program = [
      ...(saved && p.basename(saved).toLowerCase() === name.toLowerCase() ? [saved] : []),
      ...locations.map((dir) => p.join(dir, name)),
    ].find(exists);
    if (!program) continue;
    const label =
      name === "wt.exe" || name === "WindowsTerminal.exe"
        ? "Windows Terminal"
        : name === "wezterm-gui.exe" || name === "wezterm"
          ? "WezTerm"
          : name === "iTerm.app"
            ? "iTerm"
            : terminalName(program);
    if (!apps.some((app) => app.name === label)) apps.push({ path: program, name: label });
  }
  return apps;
}
