# 0071: PM mode: the coordinator splits work into small, blind pieces

- Status: accepted
- Date: 2026-10-14
- Issue: to fill

## Context

Parallax's coordinator doctrine ([coordinator.md](../../daemon/src/agents/coordinator.md)) says "one task per subagent: the largest piece that still reviews well as one pull request. Don't split work one subagent can finish in one sitting." That fits a strong coordinator on the same tier as its workers, where the cost of a run is the main thing to minimize.

This fork runs the opposite mode, which we call PM mode. The coordinator is a cheaper or open model, typically Ollama Cloud's GLM 5.3 ([0070](0070-ollama-cloud.md)), and the workers are Claude Opus or Sonnet, chosen per child ([0042](0042-project-children-are-threads.md)). The goal of the split changes with it: the coordinator's job is to keep each Claude child's context small, so a strong model sees one well-scoped piece at a time instead of a whole feature, and to assemble the pieces itself, the way object-oriented modules fit one codebase. Joey asked for this on 2026-10-14.

## Decision

The coordinator's instructions change; the machinery does not. Per-child providers and models ([0042](0042-project-children-are-threads.md)), the ask/answer inbox ([0043](0043-project-inbox-and-autonomy.md)), memory and knowledge ([0044](0044-project-memory.md)), and landing on the integration branch ([0045](0045-integration-branch.md)) already give the mode everything it needs. What changes is doctrine:

- **Small pieces.** One subagent per piece, about one file or one folder's worth of change. A piece that touches many files has grown too big and is split again.
- **Blind pieces.** A spec carries only the child's own piece. It never includes the whole request, the whole plan, or another piece's spec. The whole plan lives in shared context, in a plan's-details file the coordinator alone reads; the coordinator's `answer` to a child's `ask` carries exactly what was asked for.
- **Interfaces first.** The coordinator defines the interface between dependent pieces (types, function signatures, module layout) and puts it in both specs. The dependent piece starts from the interface, not from the other piece's implementation.
- **Land as you go.** Each piece lands as soon as its review passes, and the next piece's worktree is cut from the integration branch after it lands.
- **The style contract.** Every spec carries the naming and style conventions, the same one across a feature's specs, pulled from the repository's own conventions and the pieces already landed. Reviews judge diffs against the style contract, so pieces read as one codebase even though no child saw another.

## Consequences

- More landings and check runs: each piece pays for its own landing and its own check run ([0045](0045-integration-branch.md)), and a feature that was one PR is now many small commits on the integration branch.
- The coordinator's spec quality is the ceiling ([docs/PLAN.md](../../docs/PLAN.md)'s risk "Coordinator quality. Weak task specs make workers fail."). PM mode leans on the coordinator harder than the old doctrine, so a weak coordinator shows up as wrong splits, missing interfaces, and inconsistent pieces, not as fewer runs.
- An Ollama Cloud coordinator forces the Project into Bypass ([0042](0042-project-children-are-threads.md): the kind offers only Bypass; [0070](0070-ollama-cloud.md)), so its Claude children run without the Auto classifier or the worker sandbox. The disclaimer in 0042 covers it, and the mode makes the trade explicit: the coordinator sees everything, the children see nothing, and the user should pick the coordinator's tier knowing that.
- A child can still infer some of the whole from its piece and the repository's conventions; blind is a context budget, not secrecy.
- The doctrine lives in `coordinator.md`, which ships inside plxd, so the mode reaches every host running this fork, and `project/update`'s `permission` change doesn't turn it off.

## Alternatives

| Option | Why not |
| --- | --- |
| Keep the old doctrine, rely on memory and the brief to keep children consistent | The brief is a goal statement, not a decomposition; a small-context child still reads a whole-feature diff. |
| A new tool that the coordinator calls to hand a child its piece's context at launch | `ask` ([0043](0043-project-inbox-and-autonomy.md)) already answers mid-run questions, and the first message is built before the run starts; a new tool duplicates the inbox. |
| Land a feature in one landing after all pieces finish | Loses land-as-you-go: dependent pieces couldn't start from landed interfaces, and check runs run once instead of per piece. |
| Encode the style contract in the Project's brief | The brief is user-owned and user-visible ([0044](0044-project-memory.md)); style is per-feature, not per-project, and changes as the repository's code moves. |

## As built

- `daemon/src/agents/coordinator.md`'s "Split the work" section is inverted (small, blind pieces; interfaces first; land as you go), the spec template gains the style contract and sibling interfaces, a new "Answering `ask`" section says answers carry exactly what was asked, and the review paragraph reviews diffs against the style contract. The tool-name test in `daemon/src/mcp/thread.rs` still passes, and `child_header` is unchanged: a child's first message still carries the brief and the memory index, as 0044 keeps.
- The plan's-details file lives in shared context and is named in the doctrine; it holds the pieces, their order, the interfaces, and the style contract. The coordinator reads it before answering or reviewing; no child is told its path.