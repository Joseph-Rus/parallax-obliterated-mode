import { Bot, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentRun, Thread } from "../protocol/generated/protocol";
import { attentionOf, type Attention } from "./attention";
import { duration, WorkingMark } from "./AttentionMark";
import { models } from "./models";
import { age, backendLogos } from "./Sidebar";
import { modelName, type NativeSubagent } from "./Subagents";
import { asksOf, childrenOf, type ThreadsState } from "./threads";
import { isRunning, statusLabel, subagentLabels, type SubagentState } from "./transcript";

const dotColors: Record<Attention, string> = {
  working: "bg-working",
  needsYou: "bg-warning",
  done: "bg-added",
  failed: "bg-danger",
  settled: "bg-faint-foreground/45",
};
const attentionNames: Record<Exclude<Attention, "settled">, string> = {
  working: "Working",
  needsYou: "Needs you",
  done: "Done",
  failed: "Failed",
};
const subagentDots: Record<SubagentState, Attention> = {
  running: "working",
  completed: "settled",
  failed: "failed",
  stopped: "settled",
};
function StatusMark({ attention }: { attention: Attention }) {
  return attention === "working" ? (
    <span className="size-3.5 shrink-0 [&_svg]:size-3.5">
      <WorkingMark />
    </span>
  ) : (
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dotColors[attention]}`} />
  );
}
function ProviderLogo({ run }: { run?: AgentRun }) {
  const Logo = (run && backendLogos[run.backend]) ?? Bot;
  return <Logo aria-hidden className="size-3.5 shrink-0" />;
}
function statusText(attention: Attention, run?: AgentRun) {
  return attention !== "settled"
    ? attentionNames[attention]
    : run
      ? statusLabel(run.status)
      : "Idle";
}

/** All current and past child threads, plus the open agent's native subagents. */
export function LineageSection({
  state,
  root,
  openId,
  onOpen,
  subagents = [],
  activeSubagent,
  onOpenSubagent,
  visible,
  includeThreads = true,
}: {
  state: ThreadsState;
  root: Thread;
  openId: string;
  onOpen: (id: string) => void;
  subagents?: NativeSubagent[];
  activeSubagent?: string;
  onOpenSubagent?: (id: string) => void;
  visible: boolean;
  includeThreads?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);
  const rows: { thread: Thread; depth: number }[] = [];
  const seen = new Set<string>([root.id]);
  const walk = (thread: Thread, depth: number) => {
    if (seen.has(thread.id)) return;
    seen.add(thread.id);
    rows.push({ thread, depth });
    for (const child of childrenOf(state, thread.id)) walk(child, depth + 1);
  };
  if (includeThreads) for (const child of childrenOf(state, root.id)) walk(child, 0);
  const working =
    rows.filter(
      ({ thread }) =>
        attentionOf(thread, state.runs[thread.id], asksOf(state, thread.id)) === "working",
    ).length + subagents.filter((sub) => sub.state === "running").length;
  const nativeRows = (depth: number) =>
    subagents.map((sub) => (
      <li key={sub.callId}>
        <button
          type="button"
          aria-current={activeSubagent === sub.callId ? "page" : undefined}
          aria-label={`${sub.title}, read-only subagent, ${subagentLabels[sub.state]}`}
          title={`${sub.title} · ${subagentLabels[sub.state]} · Read-only subagent`}
          onClick={() => onOpenSubagent?.(sub.callId)}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className="flex w-full flex-col gap-0.5 rounded-md py-2 pr-2 text-left hover:bg-hover aria-current:bg-selected"
        >
          <span className="flex w-full min-w-0 items-center gap-2 text-[13px]">
            <StatusMark attention={subagentDots[sub.state]} />
            <Bot aria-hidden className="size-3.5 shrink-0" />
            <span data-lineage-title className="min-w-0 flex-1 truncate">
              {sub.title}
            </span>
            <Lock aria-hidden className="size-3 text-faint-foreground" />
          </span>
          <span className="w-full truncate pl-8 text-[11.5px] text-faint-foreground">
            {[modelName(sub.model), subagentLabels[sub.state], "Read-only subagent"]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
      </li>
    ));
  return (
    <section aria-label="Lineage" className="border-t border-border p-2">
      <h3 className="px-2 pt-1 pb-2 text-[12px] text-muted-foreground">
        Lineage{working > 0 && ` · ${working} running`}
      </h3>
      <ul className="flex flex-col gap-px">
        {openId === root.id && nativeRows(0)}
        {rows.flatMap(({ thread, depth }) => {
          const run = state.runs[thread.id];
          const attention = attentionOf(thread, run, asksOf(state, thread.id));
          const title = state.titles[thread.id] ?? "Thread";
          const model = run?.model && (models.find((m) => m.id === run.model)?.name ?? run.model);
          const end = run && (isRunning(run.status) ? now : Date.parse(run.updatedAt));
          const seconds = run && end ? Math.floor((end - Date.parse(run.createdAt)) / 1000) : 0;
          const last = run && age(run.updatedAt, now);
          const row = (
            <li key={thread.id}>
              <button
                type="button"
                aria-current={thread.id === openId && !activeSubagent ? "page" : undefined}
                title={`${title} · ${statusText(attention, run)}`}
                onClick={() => onOpen(thread.id)}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                className="flex w-full flex-col gap-0.5 rounded-md py-2 pr-2 text-left hover:bg-hover aria-current:bg-selected"
              >
                <span className="flex w-full min-w-0 items-center gap-2 text-[13px]">
                  <StatusMark attention={attention} />
                  <ProviderLogo run={run} />
                  <span data-lineage-title className="min-w-0 flex-1 truncate">
                    {title}
                  </span>
                  {run && (
                    <span className="shrink-0 text-[11.5px] text-faint-foreground tabular-nums">
                      {duration(Math.max(0, seconds))}
                    </span>
                  )}
                </span>
                <span className="w-full truncate pl-8 text-[11.5px] text-faint-foreground">
                  {[
                    model,
                    statusText(attention, run),
                    last && (last === "now" ? "just now" : `${last} ago`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          );
          return thread.id === openId ? [row, ...nativeRows(depth + 1)] : [row];
        })}
      </ul>
      {rows.length === 0 && subagents.length === 0 && (
        <p className="px-2 py-1 text-[12px] text-faint-foreground">No child threads yet</p>
      )}
    </section>
  );
}
