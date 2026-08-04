/**
 * Handing the terminal to another CLI for a moment.
 *
 * shadow cannot log you into Claude or Antigravity — those credentials belong to their
 * own binaries — so the honest flow is to step aside and let you use them directly.
 *
 * This helper deliberately does no terminal manipulation. Raw mode belongs to Ink, which
 * reference-counts it: releasing it from here would desynchronise that counter while the
 * prompt still holds a reference. The component switches its `useInput` hooks off
 * instead, and Ink restores cooked mode by itself. See the `suspended` state in App.tsx.
 */

import { spawn } from 'node:child_process';

export interface InteractiveResult {
  ok: boolean;
  /** Set when the binary could not be launched at all, as opposed to exiting non-zero. */
  error?: string;
}

function attempt(bin: string, args: string[], shell: boolean): Promise<InteractiveResult> {
  return new Promise((resolve) => {
    // stdin is left alone: Ink has already dropped its `readable` listener and unref'd it,
    // so the child gets the bytes.
    const child = spawn(bin, args, { stdio: 'inherit', shell });

    // ENOENT arrives asynchronously, so this cannot be a try/catch around spawn.
    child.on('error', (err) => resolve({ ok: false, error: (err as Error).message }));
    child.on('close', (code) => resolve({ ok: code === 0 }));
  });
}

/**
 * Run a binary with the terminal attached, and wait for it to exit.
 *
 * On Windows the target is usually a `.cmd` shim, which `spawn` cannot execute without a
 * shell — so a launch failure there is retried through one before being reported.
 */
export async function runInteractive(bin: string, args: string[] = []): Promise<InteractiveResult> {
  const first = await attempt(bin, args, false);
  if (first.ok || !first.error) return first;
  if (process.platform !== 'win32') return first;
  return attempt(bin, args, true);
}
