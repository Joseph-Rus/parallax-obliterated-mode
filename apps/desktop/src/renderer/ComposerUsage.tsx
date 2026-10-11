import { useEffect, useState } from "react";

import type { AccountLimits, UsageLimitWindow } from "../protocol/generated/protocol";
import type { RequestUsage } from "./transcript";
import { limitDetails, limitName } from "./Usage";

const refreshMs = 60_000;
const staleMs = 90_000;

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

const windowName = (name: string) =>
  name === "five_hour"
    ? "5h"
    : name === "seven_day"
      ? "Week"
      : limitName(name).replace(/ limit$/, "");

/** The composer's compact strip, using live account windows and latest-request telemetry. */
export function ComposerUsage({
  hostId,
  connected,
  backend,
  kind,
  accountId,
  usage,
}: {
  hostId: string;
  connected: boolean;
  backend: string;
  kind?: string;
  accountId: string;
  usage?: RequestUsage;
}) {
  const [loading, setLoading] = useState(connected && accountId === backend);
  const [limits, setLimits] = useState<AccountLimits>();
  const [problem, setProblem] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!connected || accountId !== backend) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const response = await window.parallax.request(hostId, "usage/limits", {});
        if (stopped) return;
        setNow(Date.now());
        setLoading(false);
        if ("result" in response) {
          const account = response.result.accounts.find((entry) => entry.accountId === accountId);
          setLimits(account);
          setProblem(account?.problem);
        } else {
          setLimits(undefined);
          setProblem("This host could not report live subscription limits.");
        }
      } catch {
        if (stopped) return;
        setLoading(false);
        setLimits(undefined);
        setProblem("This host could not report live subscription limits.");
      }
      if (!stopped) timer = setTimeout(() => void load(), refreshMs);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [hostId, connected, backend, accountId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const measured =
    connected && usage?.backend === backend && usage.accountId === accountId
      ? usage.usage
      : undefined;
  const context = tokenPercent(measured?.contextTokens, measured?.contextWindow);
  const cache = tokenPercent(measured?.cachedInputTokens, measured?.inputTokens);
  const reportedAt = usage ? ` Reported ${new Date(usage.at).toLocaleString()}.` : "";
  const windows = connected && accountId === backend ? limits?.limits : undefined;
  return (
    <div
      aria-label="Provider usage"
      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 px-5 pt-2 text-[11.5px] text-faint-foreground tabular-nums"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
        {windows?.length ? (
          windows.map((limit) => {
            const used = currentLimit(limit, now);
            return (
              <span
                key={limit.window}
                title={`${limitName(limit.window)} used. ${limitDetails(limit)}${used === undefined ? " Current utilization unavailable." : ""}`}
                className="flex items-center gap-1.5"
              >
                <span>{windowName(limit.window)}</span>
                <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-selected">
                  {used !== undefined && (
                    <span
                      className={`block h-full rounded-full ${used >= 90 ? "bg-danger" : used >= 75 ? "bg-warning" : "bg-muted-foreground"}`}
                      style={{ width: `${used}%` }}
                    />
                  )}
                </span>
                <span>{used === undefined ? "—" : `${Math.floor(used)}%`}</span>
              </span>
            );
          })
        ) : (
          <span
            title={
              problem ??
              (accountId !== backend
                ? "Subscription limits are unavailable for this API key account."
                : "This provider has not reported live subscription limits.")
            }
          >
            {connected && loading ? "Reading limits…" : "Limits unavailable"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2.5 whitespace-nowrap">
        <span
          title={
            context
              ? `${kind === "claude" ? "Latest request input" : kind === "codex" ? "Latest request tokens" : "Reported context tokens"} / provider-reported context window (${measured?.contextTokens?.toLocaleString()} / ${measured?.contextWindow?.toLocaleString()}).${reportedAt}`
              : "Context utilization unavailable until this provider reports context tokens and its window."
          }
        >
          {context ?? "—"} context
        </span>
        <span aria-hidden>·</span>
        <span title="Output speed unavailable. This provider does not report reliable model generation timing. Tool execution and turn wall-clock time are excluded.">
          — tok/s
        </span>
        <span aria-hidden>·</span>
        <span
          title={
            cache
              ? `Latest request input served from cache (${measured?.cachedInputTokens?.toLocaleString()} / ${measured?.inputTokens?.toLocaleString()} input tokens).${reportedAt}`
              : "Cache utilization unavailable until this provider reports request input and cached input tokens."
          }
        >
          {cache ?? "—"} cached
        </span>
      </div>
    </div>
  );
}
