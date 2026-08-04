# Installing Shadow

Shadow is not on npm yet, so it installs from source. These steps were run end to end
from a clean clone.

## Requirements

- **Node 20 or newer** — check with `node -v`
- **`claude` and/or `agy`, signed in.** Shadow stores no credentials of its own; it rides
  on whatever those CLIs already have. You need at least one, and Shadow is far more
  useful with both, since delegating across the two plans is the point.

## Install

```bash
git clone https://github.com/JasvlL/Shadow-CLI.git
cd Shadow-CLI
npm install
npm run build
npm install -g ./packages/cli
```

Use **npm**, not pnpm — this repo is npm workspaces (`package-lock.json`).

Then check it:

```bash
shadow doctor    # is each plan reachable?
shadow auth      # which accounts am I signed in to?
shadow           # open the IDE
```

If `shadow` is not found after installing, npm's global bin is not on your `PATH`. Print
it with `npm bin -g` and add that directory to your `PATH`.

## Signing in

Inside the IDE, `/login` opens a picker over all three accounts:

```
◆ sign in to a plan
❯ shadow         free
  claude         signed in
  antigravity    not signed in
  ↑↓ move · enter sign in · esc cancel
```

Selecting `claude` or `antigravity` hands the terminal to that CLI so you can sign in,
then returns. A plan you are not signed in to contributes no models to `/model` — that is
deliberate, and Shadow says so rather than offering models that would fail.

## Free vs PRO

Free covers everything except **multi-agent delegation** and the **quota tracker**.

Licence validation talks to a server that is not deployed yet, so `shadow auth <key>`
cannot succeed for anyone right now. To try the PRO features meanwhile:

```bash
export SHADOW_DEV=1
shadow auth TEST-PRO-KEY
```

That bypass is local only and never leaves your machine — the server does not honour it.

## Updating

```bash
cd Shadow-CLI
git pull
npm install
npm run build
npm install -g ./packages/cli
```

## Working on Shadow itself

Link instead of installing, so a rebuild takes effect immediately:

```bash
cd packages/cli && npm link
```
