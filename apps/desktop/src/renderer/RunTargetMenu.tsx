import { ChevronDown, Folder, FolderGit2, Laptop, Server } from "lucide-react";

import { useId } from "react";

import { DeviceIcon } from "./DeviceIcon";
import { localId, type Host } from "./hosts";
import { Menu, menuButton, type PickerOption } from "./ui";

/** Where a new thread works: a worktree of its own, or the repository's own checkout. */
export type Workspace = "worktree" | "checkout";

export const workspaces: (PickerOption & { value: Workspace })[] = [
  {
    value: "worktree",
    label: "New worktree",
    icon: <FolderGit2 />,
    description: "A fresh branch and folder, so your checkout stays as it is.",
  },
  {
    value: "checkout",
    label: "Local checkout",
    icon: <Folder />,
    description: "Right in the repository, on the branch you have out.",
  },
];

/**
 * A host's icon: its Parallax Connect icon (0056), else a laptop for this computer and a server
 * for an SSH host.
 */
export const hostIcon = (host: Host) =>
  host.icon ? (
    <DeviceIcon icon={host.icon} />
  ) : host.destination || host.routes ? (
    <Server />
  ) : (
    <Laptop />
  );

/** How a computer is reached, under its name. */
const connection = (host: Host) =>
  host.id === localId
    ? "This computer"
    : host.destination
      ? `SSH · ${host.destination}`
      : host.routes
        ? "Same network"
        : "Parallax Connect";

/**
 * Where a thread runs: which of Parallax's computers, and in a new worktree or the local checkout.
 * The menu stays open while you pick both. The computer and the workspace are the caller's, which
 * starts the thread on that computer with that workspace; `checkoutUnavailable`, when set, says why
 * Local checkout can't be picked. `missing` names the computers, by id, that lack the picked
 * repository, which say so.
 */
export function RunTargetMenu({
  hosts,
  hostId,
  onHostChange,
  workspace: workspaceChoice,
  onWorkspaceChange,
  checkoutUnavailable,
  missing,
}: {
  hosts: Host[];
  hostId: string;
  onHostChange: (hostId: string) => void;
  workspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
  checkoutUnavailable?: string;
  missing?: { repo: string; hostIds: ReadonlySet<string> };
}) {
  const id = useId();
  const host = hosts.find((h) => h.id === hostId) ?? hosts[0]!;
  const workspace = workspaces.find((w) => w.value === workspaceChoice)!;
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-label={`Runs on: ${host.name}, ${workspace.label}`}
        className={menuButton}
      >
        {hostIcon(host)}
        {host.name}
        <span aria-hidden className="text-faint-foreground">
          ·
        </span>
        {workspace.label}
        <ChevronDown aria-hidden className="opacity-70" />
      </button>
      <Menu
        id={id}
        label="Runs on"
        className="w-80 overflow-hidden p-0"
        focus='[aria-checked="true"]'
      >
        <div role="group" aria-label="Computer" className="grid gap-px p-1.5">
          {hosts.map((h) => {
            const selected = h === host;
            return (
              <button
                key={h.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => onHostChange(h.id)}
                className={`flex w-full items-center gap-2.5 rounded-[9px] py-1.5 pr-2 pl-1.5 text-left hover:bg-hover ${selected ? "bg-selected hover:bg-selected" : ""}`}
              >
                <span
                  className={`grid size-[30px] shrink-0 place-items-center rounded-lg border [&_svg]:size-4 ${selected ? "border-accent/35 bg-accent/15 text-accent" : "border-border bg-hover text-muted-foreground"}`}
                >
                  {hostIcon(h)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-snug font-medium">
                    {h.name}
                  </span>
                  <span className="block truncate text-[11.5px] leading-snug text-faint-foreground">
                    {connection(h)}
                  </span>
                </span>
                {missing?.hostIds.has(h.id) && (
                  <span className="shrink-0 rounded-[5px] bg-warning/12 px-1.5 py-0.5 text-[11px] text-warning">
                    no {missing.repo}
                  </span>
                )}
              </button>
            );
          })}
          {hosts.length === 1 && (
            <p className="pt-1 pr-2.5 pb-1.5 pl-[50px] text-[11.5px] text-faint-foreground">
              Computers you add under Hosts show up here.
            </p>
          )}
        </div>
        <div
          role="group"
          aria-label="Workspace"
          className="border-t border-border bg-background/50 p-1.5"
        >
          <div className="flex gap-0.5 rounded-[10px] border border-border bg-hover p-[3px]">
            {workspaces.map((w) => {
              const unavailable = w.value === "checkout" ? checkoutUnavailable : undefined;
              const selected = w === workspace;
              return (
                <button
                  key={w.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={!!unavailable}
                  title={unavailable ?? w.description}
                  onClick={() => onWorkspaceChange(w.value)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-1.5 py-1 text-[12.5px] [&_svg]:size-3.5 ${selected ? "bg-selected text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"} disabled:text-faint-foreground/60 disabled:hover:text-faint-foreground/60`}
                >
                  {w.icon}
                  {w.label}
                </button>
              );
            })}
          </div>
          {checkoutUnavailable && (
            <p className="px-1.5 pt-1.5 pb-0.5 text-[11.5px] text-faint-foreground">
              Local checkout {checkoutUnavailable}.
            </p>
          )}
        </div>
      </Menu>
    </>
  );
}
