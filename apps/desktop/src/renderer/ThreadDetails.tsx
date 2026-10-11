import { ClipboardList, FolderGit2, FolderOpen, Monitor } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Actions } from "./Actions";
import { GitMenu } from "./GitMenu";
import { LineageSection } from "./Lineage";
import { OpenMenu } from "./OpenMenu";
import { IconButton } from "./ui";

/** Where whether Thread details is shown is kept, for every thread. */
export const THREAD_DETAILS_KEY = "parallax.threadDetails";
export const THREAD_DETAILS_ID = "thread-details";

/** Whether Thread details is shown, kept across threads and restarts. */
export function useThreadDetailsOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(THREAD_DETAILS_KEY) === "open");
  const toggle = () =>
    setOpen((was) => {
      localStorage.setItem(THREAD_DETAILS_KEY, was ? "closed" : "open");
      return !was;
    });
  return [open, toggle];
}

/** The top bar's button that shows and hides Thread details. */
export function ThreadDetailsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label={open ? "Hide thread details" : "Show thread details"}
      aria-pressed={open}
      aria-expanded={open}
      aria-controls={THREAD_DETAILS_ID}
      onClick={onToggle}
    >
      <ClipboardList />
    </IconButton>
  );
}

/**
 * The thread's host, launchers, repository actions, Git status, and lineage, docked at the
 * thread's right, left of the side panel. Mounted while hidden, so the Open and action
 * shortcuts keep working.
 */
export function ThreadDetails({
  open,
  hostName,
  hostId,
  folder,
  worktree,
  actions,
  git,
  lineage,
}: {
  open: boolean;
  hostName: string;
  hostId: string;
  folder?: string;
  worktree?: boolean;
  actions?: ComponentProps<typeof Actions>;
  git?: ComponentProps<typeof GitMenu>;
  lineage?: Omit<ComponentProps<typeof LineageSection>, "visible">;
}) {
  return (
    <aside
      id={THREAD_DETAILS_ID}
      aria-label="Thread details"
      hidden={!open}
      className="w-76 shrink-0 overflow-y-auto border-l border-border bg-background"
    >
      <section aria-label="Workspace" className="p-2">
        <div className="flex items-start gap-2 px-2 py-2 text-[13px]">
          <Monitor aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{hostName}</p>
            <p
              title={folder}
              className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint-foreground"
            >
              {worktree ? (
                <FolderGit2 aria-hidden className="size-3.5 shrink-0" />
              ) : (
                <FolderOpen aria-hidden className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{folder ?? "No folder yet"}</span>
            </p>
          </div>
        </div>
        <OpenMenu hostId={hostId} folder={folder} />
        {actions && <Actions {...actions} />}
      </section>
      {git && (
        <section aria-label="Git" className="border-t border-border p-2">
          <GitMenu {...git} />
        </section>
      )}
      {lineage && <LineageSection {...lineage} visible={open} />}
    </aside>
  );
}
