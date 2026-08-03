# Shadow

A terminal IDE that runs Claude and Gemini under one orchestrator, so an agent on one
subscription can delegate work to an agent on the other — and so the conversation
survives switching between them.

```
shadow                # open the IDE   (shadow works too — same binary)
shadow -p "…"         # one turn, non-interactive
```

On-disk names stay `shadow`: `~/.shadow/agents`, `.shadow/sessions`, and the
`mcp__shadow__delegate` tool registered in agy's config. Renaming those would orphan
agents you have already installed and break the MCP bridge, so the product is Shadow and
the plumbing keeps its old name.

## Choosing a model

`/model` opens a picker over **both plans at once**:

```
◆ select a model
❯ opus                       claude  deep      hard reasoning, reviews, tricky bugs
  sonnet                     claude  balanced  everyday coding
  gemini-3.1-pro-high        agy     deep      hard reasoning, reviews, tricky bugs
  gemini-3.6-flash-low       agy     fast      quick lookups, bulk search, cheap subagents
  ↑↓ move · enter select · esc cancel — switching plan carries the conversation over
```

Picking a model on the other plan *is* a provider switch, so the row names the plan it
spends. The conversation goes with you — see below. `/model sonnet` skips the picker once
you know what you want, and `shadow models` prints the same list.

## Why

Claude Code and `agy` (Google Antigravity CLI) are two isolated agents. Each has its own
session, context and tools; neither can hand work to the other. Shadow puts one
orchestrator over both: a single session, a single permission gate, and delegation that
crosses providers in either direction — using both subscriptions at once.

A typical run: a Claude lead plans the change, delegates a broad codebase sweep to a
cheap Gemini scout, and writes the code itself. The scout burns 100k tokens of context;
the lead only pays for its summary.

## Requirements

- Node 20+
- `claude` signed in (or `ANTHROPIC_API_KEY`)
- `agy` signed in

`shadow auth` reports on both and tells you how to fix either one. Shadow stores no
credentials of its own — it reuses what each CLI already has.

## Shadow PRO

Shadow comes with a **Free tier** out of the box. You can unlock **Shadow PRO** for premium support and lifetime updates.

To activate your license:
```bash
shadow auth SHADOW-PRO-XXXX
```

## Install

```bash
npm install
npm run build
npm install -g ./packages/cli     # or, for development: cd packages/cli && npm link
```

For the reverse bridge (Gemini delegating into Claude), also run:

```bash
shadow bridge install
```

This registers Shadow as an MCP server in `~/.gemini/config/mcp_config.json`, merging
into whatever is already there.

## Commands

| Command | What it does |
|---|---|
| `shadow` | Interactive IDE |
| `shadow -p "…"` | One lead turn, delegation enabled |
| `shadow --continue` | Resume the most recent session, both providers |
| `shadow raw agy "…"` | Stream one provider directly, no orchestration |
| `shadow agents` | List agents in `.shadow/agents/` |
| `shadow models [provider]` | List models a provider accepts |
| `shadow auth` | Credential status for both providers |
| `shadow doctor` | Reachability check |
| `shadow bridge install` | Register the MCP bridge in agy's config |
| `shadow mcp` | Run the bridge on stdio (agy invokes this) |

Options: `--provider claude|agy`, `--model <id>`, `--effort low|medium|high`,
`--resume <id>`, `--json`, `-y/--yes`.

`-y` approves every tool without asking — needed for scripted `-p` runs, since a
non-interactive run has nobody to ask and the gate otherwise denies. Destructive
commands are still refused.

Agents are read from `~/.shadow/agents/` (available everywhere) and `.shadow/agents/`
in the project (shadows the user-level one by name). Install the defaults globally with:

```bash
mkdir -p ~/.shadow/agents && cp .shadow/agents/*.md ~/.shadow/agents/
```

In the IDE: `/agents`, `/provider`, `/model`, `/cost`, `/clear`, `/help`, `/exit`.
Esc interrupts a running turn.

## Agents

An agent is a markdown file in `.shadow/agents/` (or `~/.shadow/agents/` for user-level
ones; project files shadow user files of the same name).

```markdown
---
name: scout
description: Read-only codebase search. Shown to the lead so it knows what to send here.
provider: agy
model: gemini-3.6-flash-medium
writes: false
---

You locate things in a codebase. You never modify files…
```

| Field | Meaning |
|---|---|
| `provider` | `claude` or `agy` — which subscription pays |
| `model` | Provider-specific model id. Ignored if the caller redirects to another provider. |
| `effort` | `low` / `medium` / `high`, where the backend supports it |
| `tools` | Restrict the tool set, e.g. `[read_file, grep]` |
| `writes` | `true` grants a shell and routes the delegation through the permission gate |

The body is the agent's system prompt.

Three agents ship by default: `scout` (Gemini, read-only search), `reviewer` (Gemini Pro,
independent review), `builder` (Claude, bounded edits).

## Switching provider mid-conversation

**Shadow owns the conversation, not the backends.** That is the difference between this
and a launcher for two CLIs. Run out of quota on one plan and the thread survives:

```
❯ /provider agy          # or shadow --continue --provider agy
  context carried from claude to agy (~1400 tokens)
```

The next model picks up where the last one stopped — same session, same facts, same task.
Verified both directions.

How the handoff is built:

- **Recent turns travel verbatim** (6 by default). Paraphrasing the last exchange is what
  makes a continuation feel like it lost the plot.
- **Everything older travels as a summary**, kept current *during* the session rather
  than written at the moment of the switch. That timing is the point: a summary produced
  on demand would have to come from the model that just ran out of quota.
- **The summary is generated on the provider that is not leading**, with its cheapest
  model. The plan you are about to exhaust never pays to describe itself.

A switch costs one handoff and loses the prompt cache. That is paid once per switch, not
per turn — after it, the new provider resumes natively.

### When a plan runs dry

Shadow reads Claude's `rate_limit_event` (including the `allowed_warning` that arrives
*before* you are cut off) and its `rate_limit` / `billing_error` message tags. On
exhaustion it offers to continue and retries the same turn:

```
⚠ allow continue on agy?
  claude is out of quota (resets 15:40) — plan limit reached
  y/n ›
```

agy exposes no structured signal, so there Shadow pattern-matches its failure text. That
path is best-effort and documented as such; `/provider claude` always works by hand.

In `-p` mode there is nobody to ask, so it prints the command that continues the session.

## Agents on the spot

You do not need to define an agent to use one:

> *"Use 2 gemini-3.6-flash-medium agents in parallel: one to find where buildHandoff is
> defined, another for quotaFromAgyFailure."*

Naming a model is enough — the provider is inferred from it, the agent name is just a
label, and several calls in one turn run concurrently. Define an agent in
`~/.shadow/agents/` when you want a reusable persona, not to improvise.

## Project rules

`shadow init` creates `SHADOW.md`. Its contents are injected into the system prompt of
**both** providers, and of every subagent.

That injection is the point. Claude reads `CLAUDE.md` and agy reads `AGENTS.md`, so
without it the same prompt would obey different rules depending on which backend
happened to lead. Shadow resolves the files itself — `SHADOW.md`, `AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, in that order per directory — walking from the working
directory up to the repo root. An existing repo works unchanged.

Nearer files win when the budget runs out, since they are the more specific ones.

## Skills

Both CLIs already use the same format — `skills/<name>/SKILL.md` with `name` and
`description` frontmatter. Shadow does not invent a third one. It finds every skill root
on the machine and points **both** backends at all of them, so a skill you wrote for
Claude works when a Gemini lead runs, and vice versa.

```bash
shadow skills                # list, with origin and description
shadow skills sync           # share every root with agy (--dry-run to preview)
shadow skills new <name>     # scaffold ~/.shadow/skills/<name>/SKILL.md
shadow skills lint           # warn about skills that only work on one provider
```

Roots discovered: `~/.shadow/skills`, `~/.claude/skills`, every
`~/.claude/plugins/cache/**/skills`, and `.shadow|.claude|.agents/skills` in the project.

Nothing is copied. `sync` merges paths into `~/.gemini/config/skills.json`, keeping any
entries you added yourself; Claude picks its own up through `settingSources: ['user']`,
plus `~/.shadow` as a generated local plugin.

**The portability limit is real.** The file format travels; the content does not always.
A skill that says "use the Edit tool" is a dead end on agy, where that tool is called
`replace_file_content`. `shadow skills lint` flags one-sided skills — it warns rather than
rewrites, because which provider a skill targets is the author's call.

## How it works

```
shadow
├─ providers/  one interface, two backends
│    ClaudeProvider → @anthropic-ai/claude-agent-sdk (in-process)
│    AgyProvider    → spawns `agy -p … --output-format stream-json`, parses NDJSON
├─ core/       orchestrator, agent registry, permission gate, session log
├─ tools/      fs, shell, grep, glob — one implementation, shared
├─ mcp/        stdio server exposing `delegate` so agy can call back in
├─ tui/        Ink components
└─ cli/        entrypoint; bundles the workspace into one binary
```

Every backend is normalized to one event stream:

```ts
type ShadowEvent =
  | { t: 'init'; provider; sessionRef; model; tools }
  | { t: 'text' | 'thinking'; delta }
  | { t: 'tool_call' | 'tool_result'; … }
  | { t: 'usage'; input; output; cacheRead; thinking }
  | { t: 'done'; text; status } | { t: 'error'; message };
```

Delegation is deliberately narrow: a subagent takes a prompt and returns one string.
That is what makes context isolation work, and a string is the only thing both backends
agree on. Several `delegate` calls in one turn run concurrently, bounded by a semaphore.

**Direction matters.** Claude reaches subagents through an in-process MCP tool
(`mcp__shadow__delegate`). agy runs in its own process, so it reaches them over the stdio
bridge instead. Both land in the same `Orchestrator.delegate`.

Sessions are JSONL under `.shadow/sessions/`, one line per event. The header tracks a
conversation ref *per provider*, which is how `--continue` resumes both.

## Permissions

Shadow turns off each backend's own prompting, because a subagent has no terminal — a
backend that stops to ask simply stalls and returns nothing. **That makes shadow's gate
the only thing between a model and your filesystem.**

Order: deny-list → destructive-command screen → allow-list → ask the user. The
destructive screen sits above the allow-list on purpose, so no config entry can
pre-approve `rm -rf`. With nothing attached to ask, the gate denies.

Configure in `.shadow/config.json`:

```json
{
  "permissions": {
    "allow": ["read_file", "glob", "grep"],
    "deny": [],
    "autoApprove": false
  }
}
```

The gate covers the lead's own tools too, via the SDK's `canUseTool`. One trap worth
recording: putting bare tool names in the SDK's `allowedTools` **auto-approves them
before `canUseTool` runs**, silently bypassing the gate. Shadow therefore withholds tools
with `disallowedTools` and never allow-lists them. If you add tools to the lead, do the
same.

### Hooks

`.shadow/hooks.json` runs commands at lifecycle points, for **both** providers, because
shadow runs them rather than either backend:

```json
{
  "PreToolUse":  [{ "matcher": "Write|Edit", "command": "npm run lint --silent" }],
  "PostToolUse": [{ "matcher": "Write|Edit", "command": "npm test --silent" }]
}
```

A non-zero `PreToolUse` exit blocks the tool. Hooks run even under `-y`: skipping
permission prompts is not the same as consenting to skip a repo's own checks.

**A narrow matcher does not contain an agent.** Tested: a hook matching `Write|Edit`
blocked the Write — and the model immediately wrote the same file through PowerShell
instead. The block was correct and the policy was still bypassed. If a hook is meant as
a policy rather than a lint step, omit `matcher` so it applies to every tool; with a
catch-all matcher the same request was refused outright.

Hooks load only from `<cwd>/.shadow/hooks.json` — never inherited from parent directories
— and `shadow --no-hooks` disables them.

### Plan mode

`shadow --plan`, or `/plan` in the IDE. Passes `permissionMode: 'plan'` to Claude and
`--mode plan` to agy, and outranks `-y`: nothing executes regardless of the other flags.

Two limits worth knowing:

- The destructive-pattern list is defence in depth, not a security boundary. It stops
  the plausible accident, not a determined attempt to obfuscate around it.
- A read-only agent's read-only-ness is enforced by `agy --sandbox` plus its prompt, not
  by a hard capability boundary.

## Development

```bash
npm run build          # builds in dependency order — do not use --workspaces here
npx vitest run         # 57 offline tests
SHADOW_LIVE=1 npx vitest run   # adds live tests; these spend real quota
```

Set `SHADOW_DEBUG=1` to log agy NDJSON lines the parser could not understand.

The parser is tested against NDJSON fixtures captured from real `agy` runs
(`packages/providers/test/fixtures/`). If agy changes its output format, those tests are
what will tell you.

## Note on terms of service

Shadow drives two subscription CLIs from a third program. That is a grey area in both
providers' terms. Fine for personal use on your own machine; check the terms before
distributing it.
