import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { AccountLimits, UsageLimitWindow } from "../protocol/generated/protocol";
import type { RequestUsage } from "./transcript";
import { clockOptions, setBehaviorPrefs } from "./prefs";
import { limitDetails, limitName } from "./Usage";

const refreshMs = 60_000;
const staleMs = 90_000;

type LimitsAnswer = Awaited<ReturnType<typeof readLimits>>;
/** Each host's last answer and the read under way, shared by every strip: plxd starts the
 * providers' CLIs for each read, so open threads and remounts must not multiply them. */
const limitReads = new Map<string, { at: number; answer: Promise<LimitsAnswer> }>();
function readLimits(hostId: string) {
  return window.parallax.request(hostId, "usage/limits", {});
}
function sharedLimits(hostId: string, now = Date.now()): Promise<LimitsAnswer> {
  const last = limitReads.get(hostId);
  if (last && now - last.at < refreshMs) return last.answer;
  const answer = readLimits(hostId);
  limitReads.set(hostId, { at: now, answer });
  // A failed read, or an error answer, is retried by the next strip instead of being kept.
  const forget = () => limitReads.get(hostId)?.answer === answer && limitReads.delete(hostId);
  answer.then((response) => "error" in response && forget(), forget);
  return answer;
}
/** For tests: forgets every host's shared answer. */
export function forgetLimits() {
  limitReads.clear();
}

/** Only current, valid provider observations can fill a limit meter. */
export function currentLimit(limit: UsageLimitWindow, now: number): number | undefined {
  const captured = Date.parse(limit.capturedAt);
  const reset = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt);
  const used = limit.usedPercent;
  if (
    !Number.isFinite(captured) ||
    captured > now ||
    now - captured > staleMs ||
    (reset !== undefined && (!Number.isFinite(reset) || reset <= now)) ||
    used === undefined ||
    !Number.isFinite(used) ||
    used < 0 ||
    used > 100
  )
    return undefined;
  return used;
}

/** Missing, zero-denominator, and inconsistent token counts remain unknown. */
export function tokenPercent(numerator?: number, denominator?: number): string | undefined {
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0 ||
    numerator > denominator
  )
    return undefined;
  const percent = (numerator / denominator) * 100;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.floor(percent)}%`;
}

/** An approximate output rate, or unknown when either side is missing or invalid. */
export function tokensPerSecond(tokens?: number, ms?: number): number | undefined {
  if (
    tokens === undefined ||
    ms === undefined ||
    !Number.isSafeInteger(tokens) ||
    !Number.isSafeInteger(ms) ||
    tokens <= 0 ||
    ms <= 0
  )
    return undefined;
  return Math.round((tokens / ms) * 1000);
}

/** What each provider's sample measures, since neither is pure generation time. */
const speedSource: Record<string, string> = {
  claude:
    "Claude's API time for the last turn, which includes waiting for each request's first token and any subagent requests",
  opencode:
    "the time OpenCode spent streaming text and reasoning in the last model request without tool calls, which leaves out the wait for the first token",
};

const windowName = (name: string) =>
  name === "five_hour"
    ? "5h"
    : name === "seven_day"
      ? "Week"
      : limitName(name).replace(/ limit$/, "");

/** How full a meter is: amber from 75%, red from 90%, as on the Usage page. */
const tone = (used: number) => (used >= 90 ? "danger" : used >= 75 ? "warning" : "normal");
const fill = { normal: "bg-muted-foreground", warning: "bg-warning", danger: "bg-danger" };

/** One subscription window, current or shown as unknown. */
interface Window {
  key: string;
  name: string;
  /** Percent used, when the observation is current. */
  used?: number;
  title: string;
  resetsAt?: string;
}

/** What the composer shows about a provider, from live account windows and request telemetry. */
export interface ComposerUsageData {
  account: string;
  windows: Window[];
  /** Why there are no windows. Absent while there are some. */
  limitsNote?: { text: string; title: string };
  context?: string;
  /** Context use, 0 to 100, for the ring. */
  contextUsed?: number;
  contextDetail?: string;
  contextTitle: string;
  cache?: string;
  cacheTitle: string;
  speed?: number;
  speedTitle: string;
  /** The fullest current meter, window or context, which tints the ring. */
  worst?: number;
  /** A line to show inside the box when a window or the context is nearly full. */
  warning?: string;
}

const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "4:20 PM" today, "Thu 9:00 AM" later in the week. */
function resetTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  const later = at - now > 20 * 60 * 60 * 1000;
  return new Date(at).toLocaleString(undefined, {
    ...(later && { weekday: "short" }),
    ...clockOptions(),
  });
}

/**
 * Reads the account's live limit windows (shared per host, refreshed each minute) and turns them
 * and the run's latest request telemetry into what the composer shows. Nothing until a host and
 * provider are known.
 */
export function useComposerUsage({
  hostId,
  connected,
  backend,
  kind,
  accountId,
  usage,
}: {
  hostId?: string;
  connected: boolean;
  backend?: string;
  kind?: string;
  accountId?: string;
  usage?: RequestUsage;
}): ComposerUsageData | undefined {
  const key = `${hostId}/${backend}/${accountId}/${connected}`;
  const subscription = connected && !!hostId && !!backend && accountId === backend;
  // The answer for one host, provider, and account; another key's is never shown.
  const [read, setRead] = useState<{ key: string; limits?: AccountLimits; problem?: string }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!subscription) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = "This host could not report live subscription limits.";
    const load = async () => {
      try {
        const response = await sharedLimits(hostId);
        if (stopped) return;
        setNow(Date.now());
        if ("result" in response) {
          const account = response.result.accounts.find((entry) => entry.accountId === accountId);
          setRead({ key, limits: account, problem: account?.problem });
        } else setRead({ key, problem: failed });
      } catch {
        if (stopped) return;
        setRead({ key, problem: failed });
      }
      if (!stopped) timer = setTimeout(() => void load(), refreshMs);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key, subscription, hostId, accountId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  if (!hostId || !backend || !accountId) return undefined;

  const current = read?.key === key ? read : undefined;
  const windows: Window[] = (subscription ? (current?.limits?.limits ?? []) : []).map((limit) => {
    const used = currentLimit(limit, now);
    return {
      key: limit.window,
      name: windowName(limit.window),
      used,
      resetsAt: limit.resetsAt,
      title: `${limitName(limit.window)} used. ${limitDetails(limit)}${used === undefined ? " Current utilization unavailable." : ""}`,
    };
  });
  const limitsNote = windows.length
    ? undefined
    : {
        text: subscription && !current ? "Reading limits…" : "Limits unavailable",
        title:
          current?.problem ??
          (accountId !== backend
            ? "Subscription limits are unavailable for this API key account."
            : "This provider has not reported live subscription limits."),
      };

  const measured =
    connected && usage?.backend === backend && usage.accountId === accountId
      ? usage.usage
      : undefined;
  const reportedAt = measured && usage ? ` Reported ${new Date(usage.at).toLocaleString()}.` : "";
  const context = tokenPercent(measured?.contextTokens, measured?.contextWindow);
  const contextUsed =
    context === undefined ? undefined : (measured!.contextTokens! / measured!.contextWindow!) * 100;
  const cache = tokenPercent(measured?.cachedInputTokens, measured?.inputTokens);
  const timed = !!kind && !!speedSource[kind];
  const speed = timed ? tokensPerSecond(measured?.outputTokens, measured?.outputMs) : undefined;

  const known = [...windows.map((w) => w.used), contextUsed].filter(
    (used): used is number => used !== undefined,
  );
  const worst = known.length ? Math.max(...known) : undefined;
  const nearly = windows.find((w) => w.used !== undefined && w.used >= 90);
  const warning = [
    nearly &&
      `${limitName(nearly.key)} ${Math.floor(nearly.used!)}% used${nearly.resetsAt ? ` · resets ${resetTime(nearly.resetsAt, now)}` : ""}`,
    contextUsed !== undefined && contextUsed >= 90 && `Context ${context} full`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    account: accountId,
    windows,
    limitsNote,
    context,
    contextUsed,
    contextDetail:
      context === undefined
        ? undefined
        : `${compact(measured!.contextTokens!)} / ${compact(measured!.contextWindow!)}`,
    contextTitle: context
      ? `${kind === "claude" ? "Latest request input" : kind === "codex" ? "Latest request tokens" : "Reported context tokens"} / provider-reported context window (${measured?.contextTokens?.toLocaleString()} / ${measured?.contextWindow?.toLocaleString()}).${reportedAt}`
      : "Context utilization unavailable until this provider reports context tokens and its window.",
    cache,
    cacheTitle: cache
      ? `Latest request input served from cache (${measured?.cachedInputTokens?.toLocaleString()} / ${measured?.inputTokens?.toLocaleString()} input tokens).${reportedAt}`
      : "Cache utilization unavailable until this provider reports request input and cached input tokens.",
    speed,
    speedTitle:
      speed !== undefined && kind
        ? `Approximate output speed: ${measured?.outputTokens?.toLocaleString()} output tokens over ${speedSource[kind]} (${((measured?.outputMs ?? 0) / 1000).toFixed(1)} s).${reportedAt}`
        : timed
          ? "Output speed unavailable until this provider reports output tokens and their timing."
          : "Output speed unavailable. This provider does not report model timing, and turn wall-clock time would include tool runs.",
    worst,
    warning: warning || undefined,
  };
}

/** The view that should take focus when it mounts: switching views removes the control used. */
let focusNext: "ring" | "row" | undefined;
const switchView = (view: "ring" | "row") => {
  focusNext = view;
  setBehaviorPrefs({ composerUsage: view });
};

const speedText = (speed?: number) =>
  speed === undefined ? "— tok/s" : `~${speed.toLocaleString()} tok/s`;

/** A small meter, its bar left empty when the value is unknown. */
function Meter({ used, className }: { used?: number; className: string }) {
  return (
    <span aria-hidden className={`overflow-hidden rounded-full bg-selected ${className}`}>
      {used !== undefined && (
        <span
          className={`block h-full rounded-full ${fill[tone(used)]}`}
          style={{ width: `${used}%` }}
        />
      )}
    </span>
  );
}

/**
 * The full row of meters inside the prompt box, under its pickers: subscription windows on the
 * left, the thread's context, speed, and cache on the right. Its ✕ goes back to the ring.
 */
export function UsageRow({ data }: { data: ComposerUsageData }) {
  const collapse = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusNext !== "row") return;
    focusNext = undefined;
    collapse.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-label="Provider usage"
      className="group/usage mx-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-t border-border/60 px-1 pt-2 pb-2.5 text-[11.5px] text-muted-foreground tabular-nums"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        {data.limitsNote ? (
          <span title={data.limitsNote.title}>{data.limitsNote.text}</span>
        ) : (
          data.windows.map((w) => (
            <span key={w.key} title={w.title} className="flex items-center gap-1.5">
              <span>{w.name}</span>
              <Meter used={w.used} className="h-1 w-9" />
              <span>{w.used === undefined ? "—" : `${Math.floor(w.used)}%`}</span>
            </span>
          ))
        )}
      </div>
      <div className="flex items-center gap-2.5 whitespace-nowrap">
        <span title={data.contextTitle}>{data.context ?? "—"} context</span>
        <span aria-hidden className="text-faint-foreground">
          ·
        </span>
        <span title={data.speedTitle}>{speedText(data.speed)}</span>
        <span aria-hidden className="text-faint-foreground">
          ·
        </span>
        <span title={data.cacheTitle}>{data.cache ?? "—"} cached</span>
        <button
          ref={collapse}
          type="button"
          aria-label="Show usage as a ring"
          title="Show usage as a ring"
          onClick={() => switchView("ring")}
          className="-my-1 -mr-1 grid size-5 place-items-center rounded-md text-faint-foreground opacity-0 group-hover/usage:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3"
        >
          <X />
        </button>
      </div>
    </div>
  );
}

const ringTone = { normal: "text-accent", warning: "text-warning", danger: "text-danger" };

/**
 * One ring by the send button that fills with the thread's context use, tinted by the fullest
 * meter. Hovering or focusing it opens a card with every meter and a switch that pins the row.
 */
export function UsageRing({ data }: { data: ComposerUsageData }) {
  // Hover and focus peek at the card; a click keeps it open until a second click, Escape, or
  // focus leaving it, so a click right after hovering doesn't close what hovering opened.
  const [peek, setPeek] = useState(false);
  const [kept, setKept] = useState(false);
  const open = peek || kept;
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  // Focus given back after the row collapses shouldn't open the card again.
  const quiet = useRef(false);
  const card = useId();
  const show = () => {
    clearTimeout(closing.current);
    setPeek(true);
  };
  // A short delay lets the pointer cross from the ring to the card.
  const hide = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => setPeek(false), 150);
  };
  const close = () => {
    clearTimeout(closing.current);
    setPeek(false);
    setKept(false);
  };
  useEffect(() => {
    if (focusNext === "ring") {
      focusNext = undefined;
      quiet.current = true;
      button.current?.focus();
      quiet.current = false;
    }
    return () => clearTimeout(closing.current);
  }, []);
  const r = 8.5;
  const around = 2 * Math.PI * r;
  const filled = data.contextUsed ?? 0;
  const summary = `Usage: ${data.context ?? "—"} context${data.limitsNote ? `, ${data.limitsNote.text.replace(/…$/, "")}` : ""}${data.windows
    .filter((w) => w.used !== undefined)
    .map((w) => `, ${w.name} ${Math.floor(w.used!)}%`)
    .join("")}`;
  return (
    <div
      className="relative"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => quiet.current || show()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={summary}
        aria-expanded={open}
        aria-controls={card}
        onClick={() => (kept ? close() : setKept(true))}
        className={`grid size-9 place-items-center rounded-full hover:bg-hover ${data.worst === undefined ? "text-faint-foreground" : ringTone[tone(data.worst)]}`}
      >
        <svg aria-hidden viewBox="0 0 22 22" className="size-[18px] -rotate-90">
          <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" className="stroke-selected" />
          {filled > 0 && (
            <circle
              cx="11"
              cy="11"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={around}
              strokeDashoffset={around * (1 - Math.max(filled, 4) / 100)}
            />
          )}
        </svg>
      </button>
      <div
        id={card}
        role="dialog"
        aria-label="Provider usage"
        hidden={!open}
        className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-xl border border-border bg-surface p-3 text-[12px] text-foreground shadow-composer tabular-nums"
      >
        <CardHeading>Limits</CardHeading>
        {data.limitsNote ? (
          <p title={data.limitsNote.title} className="text-muted-foreground">
            {data.limitsNote.text}
          </p>
        ) : (
          data.windows.map((w) => (
            <div
              key={w.key}
              title={w.title}
              className="my-1.5 grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-2"
            >
              <span className="truncate">{w.name}</span>
              <Meter used={w.used} className="h-1.5" />
              <span className="text-right text-muted-foreground">
                {w.used === undefined ? "—" : `${Math.floor(w.used)}%`}
              </span>
            </div>
          ))
        )}
        <hr className="my-2.5 border-border" />
        <CardHeading>This thread</CardHeading>
        <CardRow label="Context" title={data.contextTitle}>
          {data.context ? `${data.contextDetail} · ${data.context}` : "—"}
        </CardRow>
        <CardRow label="Cached input" title={data.cacheTitle}>
          {data.cache ?? "—"}
        </CardRow>
        <CardRow label="Output speed" title={data.speedTitle}>
          {speedText(data.speed)}
        </CardRow>
        <hr className="my-2.5 border-border" />
        <button
          type="button"
          role="switch"
          aria-checked={false}
          onClick={() => switchView("row")}
          className="-mx-1.5 -my-1 flex w-[calc(100%+0.75rem)] items-center justify-between rounded-md px-1.5 py-1 hover:bg-hover"
        >
          <span>Show in composer</span>
          <span aria-hidden className="relative h-4 w-7 rounded-full bg-faint-foreground">
            <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow" />
          </span>
        </button>
      </div>
    </div>
  );
}

function CardHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-faint-foreground uppercase">
      {children}
    </p>
  );
}

function CardRow({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div title={title} className="my-1 flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** An amber line inside the box when a window or the context is nearly full. */
export function UsageWarning({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 rounded-b-3xl border-t border-warning/25 bg-warning/10 px-5 py-2 text-[12px] text-warning"
    >
      <span aria-hidden>⚠</span>
      {text}
    </p>
  );
}
