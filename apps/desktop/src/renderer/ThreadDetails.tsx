import { ClipboardList, FolderGit2, FolderOpen, Monitor } from "lucide-react";
import { useId, useRef, useState, type ComponentProps, type ToggleEvent } from "react";

import { Actions } from "./Actions";
import { GitMenu } from "./GitMenu";
import { LineageSection } from "./Lineage";
import { OpenMenu } from "./OpenMenu";
import { IconButton, menuPanel } from "./ui";

/** The thread's host, launchers, repository actions, Git status, and lineage in one panel. */
export function ThreadDetails({
  hostName,
  hostId,
  folder,
  worktree,
  actions,
  git,
  lineage,
}: {
  hostName: string;
  hostId: string;
  folder?: string;
  worktree?: boolean;
  actions?: ComponentProps<typeof Actions>;
  git?: ComponentProps<typeof GitMenu>;
  lineage?: Omit<ComponentProps<typeof LineageSection>, "visible">;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => panel.current?.hidePopover();
  return (
    <>
      <IconButton
        label="Thread details"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-pressed={open}
      >
        <ClipboardList />
      </IconButton>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Thread details"
        onToggle={(event: ToggleEvent<HTMLDivElement>) => {
          const shown = event.newState === "open";
          setOpen(shown);
          if (shown) panel.current?.querySelector<HTMLElement>("button:enabled")?.focus();
        }}
        className={`${menuPanel("end")} w-84 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl`}
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
          {actions && (
            <Actions
              {...actions}
              onRun={(action) => {
                close();
                actions.onRun(action);
              }}
            />
          )}
        </section>
        {git && (
          <section aria-label="Git" className="border-t border-border p-2">
            <GitMenu
              {...git}
              onChanges={() => {
                close();
                git.onChanges?.();
              }}
            />
          </section>
        )}
        {lineage && (
          <LineageSection
            {...lineage}
            visible={open}
            onOpen={(threadId) => {
              close();
              lineage.onOpen(threadId);
            }}
            onOpenSubagent={(callId) => {
              close();
              lineage.onOpenSubagent?.(callId);
            }}
          />
        )}
      </div>
    </>
  );
}
