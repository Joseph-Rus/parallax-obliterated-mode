# Fork issue list

This fork can't reach the upstream Linear workspace (ryanstoffel), so work is
tracked here instead of Linear. Every branch still names its issue, by number
below: `feature/F1-<slug>`, `bug/F2-...`, `chore/F3-...`, `docs/F4-...`.
Upstream issues keep their PLX ids; fork-only work takes the next free F number.

One issue per PR. Each entry: problem, acceptance criteria as a checklist,
status (planned / in progress / in review / done), and the PR that landed it.
Progress and decisions go in the PR; this file is the index only.

## F1: PM mode: the coordinator decomposes work into small blind pieces

Status: in review

Problem: the coordinator doctrine told subagents to take "the largest piece
that still reviews well as one pull request", which fits a strong coordinator
on the same tier as its workers. This fork runs the opposite mode: a cheaper
or open coordinator (typically Ollama Cloud's GLM 5.3) splits each request
into pieces about one file or one folder deep, each child (typically Claude
Opus or Sonnet) sees only its own piece, and a style contract plus
interface-first specs keep the pieces consistent as one codebase.

Acceptance criteria:
- [x] coordinator.md's splitting doctrine is inverted: small pieces, about one
  file or one folder each, with interface-first decomposition when pieces
  depend on each other
- [x] Every spec carries a style contract and only the child's own piece: no
  other pieces' plans, not the whole request
- [x] The coordinator answers a child's ask with exactly the context needed,
  never the whole plan
- [x] Land-as-you-go: later pieces start from the integration branch after the
  previous piece lands
- [x] Diffs are reviewed against the style contract, not only the spec
- [x] Decision record docs/decisions/0071-pm-mode-small-blind-pieces.md
  documents the mode, including that an Ollama Cloud coordinator forces the
  Project into Bypass (0042, 0070)
- [x] The coordinator.md tool-name test passes; cargo fmt, clippy, and the
  daemon's tests pass (784 passed, 0 failed)

PR: to fill once opened. Branch: `feature/pm-mode-small-blind-pieces`.
Asked for by Joey, 2026-10-14.