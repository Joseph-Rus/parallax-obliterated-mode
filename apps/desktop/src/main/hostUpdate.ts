import type { ConnectionState, HostUpdateEvent, RpcResponse } from "../preload/bridge";
import type { HostUpdateResult } from "../protocol/generated/protocol";

// Keeping every connected computer's plxd on the app's version (PLX-700, decision 0066). Once the
// local plxd runs the app's version, so after an update, each remote host whose plxd is older is
// updated once per launch: through its own `host/update` when it has it, else by the SSH install
// for an SSH host, else the user is told how.

/** A release version's numbers, without its channel: `[2610, 10912, 13045]` (0030). */
export function versionNumbers(version: string): number[] | undefined {
  const numbers = version.split("-")[0]!.split(".");
  if (!numbers.every((n) => /^\d+$/.test(n))) return undefined;
  return numbers.map(Number);
}

/**
 * Compares two versions by their numbers, a missing one counting as 0, and the channel not at
 * all: negative when `a` is older. Undefined when either isn't a version.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const [x, y] = [versionNumbers(a), versionNumbers(b)];
  if (!x || !y) return undefined;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const order = (x[i] ?? 0) - (y[i] ?? 0);
    if (order !== 0) return order;
  }
  return 0;
}

/** Whether plxd `plxd` is older than the app's `version`. */
export const isOlder = (plxd: string, version: string) => (compareVersions(plxd, version) ?? 0) < 0;

/** How a remote host is reached, which decides how its plxd updates without `host/update`. */
export type HostKind = "ssh" | "remote";

export type HostUpdaterDeps = {
  /** A packaged app, not a development build or one running `PLXD_PATH`. */
  packaged: boolean;
  /** The app's version, which each host's plxd is updated to. */
  version: string;
  /** The channel plx-connect installs from. */
  channel: "stable" | "nightly";
  /** `ssh` for a saved SSH host, `remote` for a LAN computer or Connect device, else undefined. */
  kindOf: (hostId: string) => HostKind | undefined;
  /** Each host's connection state now, `local` included. */
  states: () => Iterable<[string, ConnectionState]>;
  /** Sends `host/update`, waiting as long as a download takes. */
  update: (hostId: string, version: string) => Promise<RpcResponse<HostUpdateResult>>;
  /** Installs the app's plxd over ssh and reconnects; resolves to an error for people. */
  installSsh: (hostId: string) => Promise<string | undefined>;
  /** The host's OS, as `host/version` names it. */
  osOf: (hostId: string) => Promise<string | undefined>;
  /** Tells the windows. */
  emit: (event: HostUpdateEvent) => void;
};

/** What to tell a user whose plxd can't update itself, on a host the app can't reach by ssh. */
export function unsupportedMessage(plxd: string, os: string | undefined, channel: string): string {
  const old = `plxd ${plxd} there is too old to update itself.`;
  if (/^(macos|windows)/i.test(os ?? "")) return `${old} Update Parallax on that computer.`;
  return `${old} On that computer, run: npx plx-connect setup --channel ${channel}`;
}

export class HostUpdater {
  /** Hosts tried this launch, as `hostId@version`, so each is tried once. */
  private readonly tried = new Set<string>();
  /** Hosts updating, by the version that's done when they reconnect on it. */
  private readonly pending = new Map<string, string>();
  /** The local plxd ran the app's version once this launch. */
  private localCurrent = false;

  constructor(private readonly deps: HostUpdaterDeps) {}

  /** Follows every host's connection state. */
  onState(hostId: string, state: ConnectionState): void {
    if (state.status !== "connected") return;
    if (hostId === "local") {
      if (this.localCurrent || compareVersions(state.plxd, this.deps.version) !== 0) return;
      this.localCurrent = true;
      for (const [id, each] of this.deps.states()) if (id !== "local") this.consider(id, each);
      return;
    }
    const waiting = this.pending.get(hostId);
    if (waiting !== undefined) {
      if (isOlder(state.plxd, waiting)) return;
      this.pending.delete(hostId);
      this.deps.emit({ hostId, status: "updated", version: state.plxd });
      return;
    }
    if (this.localCurrent) this.consider(hostId, state);
  }

  /** Tries a host again, as the failure notice's Retry does. */
  retry(hostId: string): void {
    this.tried.delete(`${hostId}@${this.deps.version}`);
    const state = new Map(this.deps.states()).get(hostId);
    if (state) this.consider(hostId, state);
  }

  /** Updates `hostId` if it's a remote host, connected on an older plxd, not tried yet. */
  private consider(hostId: string, state: ConnectionState): void {
    const { packaged, version } = this.deps;
    if (!packaged || state.status !== "connected" || !isOlder(state.plxd, version)) return;
    const kind = this.deps.kindOf(hostId);
    const key = `${hostId}@${version}`;
    if (!kind || this.tried.has(key)) return;
    this.tried.add(key);
    void this.run(hostId, kind, state).catch((error: unknown) =>
      this.fail(hostId, error instanceof Error ? error.message : String(error)),
    );
  }

  private async run(
    hostId: string,
    kind: HostKind,
    state: Extract<ConnectionState, { status: "connected" }>,
  ): Promise<void> {
    const { version } = this.deps;
    if ("hostUpdate" in state.capabilities) {
      const answer = await this.deps.update(hostId, version);
      if ("error" in answer) return this.fail(hostId, answer.error.message);
      // It reconnects on the new version: now, or once its agents' turns end.
      if (answer.result.restart !== "upToDate") this.pending.set(hostId, version);
      return;
    }
    if (kind === "ssh") {
      // The new connection may be up before this resolves, so it waits first.
      this.pending.set(hostId, version);
      const error = await this.deps.installSsh(hostId);
      if (error) {
        this.pending.delete(hostId);
        this.fail(hostId, error);
      }
      return;
    }
    const os = await this.deps.osOf(hostId);
    this.fail(hostId, unsupportedMessage(state.plxd, os, this.deps.channel));
  }

  private fail(hostId: string, error: string): void {
    this.deps.emit({ hostId, status: "failed", error });
  }
}
