import { ClipboardList, FolderGit2, FolderOpen, Monitor } from "lucide-react";
import { useLayoutEffect, useState, type ComponentProps } from "react";

import { Actions } from "./Actions";
import { GitMenu } from "./GitMenu";
import { LineageSection } from "./Lineage";
import { OpenMenu } from "./OpenMenu";
import { IconButton } from "./ui";

/** Where whether Thread details is shown is kept, for every thread. */
export const THREAD_DETAILS_KEY = "parallax.threadDetails";
export const THREAD_DETAILS_ID = "thread-details";

/** The docked card's width, `w-84`, with its right gap. */
const DOCKED_WIDTH = 348;
/** The least of its row the thread keeps beside the docked card; below it the card floats. */
export const THREAD_MIN_SHARE = 0.6;

/** Whether docking Thread details in a row `width` wide would leave the thread too little room. */
export const tooNarrowToDock = (width: number) =>
  width > 0 && width - DOCKED_WIDTH < width * THREAD_MIN_SHARE;

export type ThreadDetailsMode = "docked" | "floating" | "hidden";

/**
 * Where Thread details shows, for the thread row `ref` is set on, which may unmount and return
 * (behind the Pull requests page) and is measured again each time. With room it docks while the kept choice
 * says shown. Without room (the thread would keep less than `THREAD_MIN_SHARE` of the row) it
 * starts hidden, and the button floats it over the thread until pressed again; the kept choice is
 * left alone. Crossing the line either way closes a floating card.
 */
export function useThreadDetails() {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [docked, setDocked] = useState(() => localStorage.getItem(THREAD_DETAILS_KEY) === "open");
  const [floating, setFloating] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = tooNarrowToDock(element.getBoundingClientRect().width);
      setNarrow((was) => {
        if (was !== next) setFloating(false);
        return next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const toggle = () => {
    if (narrow) return setFloating((was) => !was);
    setDocked((was) => {
      localStorage.setItem(THREAD_DETAILS_KEY, was ? "closed" : "open");
      return !was;
    });
  };
  const mode: ThreadDetailsMode = narrow
    ? floating
      ? "floating"
      : "hidden"
    : docked
      ? "docked"
      : "hidden";
  return { mode, toggle, ref };
}

/** The top bar's button that shows and hides Thread details. */
export function ThreadDetailsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label="Thread details"
      aria-pressed={open}
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
  mode,
  hostName,
  hostId,
  folder,
  worktree,
  actions,
  git,
  lineage,
}: {
  mode: ThreadDetailsMode;
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
      hidden={mode === "hidden"}
      data-mode={mode}
      // Docked, it takes room in the thread's row; floating, it hovers over the thread's right on
      // frosted glass. Either way it's a card sized to its rows, scrolling at the row's height.
      className={`flex w-84 flex-col py-2 pr-3 ${
        mode === "floating"
          ? "pointer-events-none absolute inset-y-0 right-0 z-30 max-w-[calc(100%-1rem)]"
          : "shrink-0"
      }`}
    >
      <div
        className={`pointer-events-auto max-h-full overflow-y-auto rounded-xl border border-border text-foreground shadow-composer ${
          mode === "floating"
            ? "bg-surface/55 backdrop-blur-3xl backdrop-saturate-150"
            : "bg-surface"
        }`}
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
        {lineage && <LineageSection {...lineage} visible={mode !== "hidden"} />}
      </div>
    </aside>
  );
}
