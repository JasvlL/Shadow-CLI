/**
 * Session persistence.
 *
 * One JSONL file per session, one line per event. The header line carries the
 * per-provider conversation refs, which is what makes `flick --continue` able to
 * resume *both* backends rather than just the last one used.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ProviderId } from '@flick/providers';

export interface SessionHeader {
  kind: 'header';
  id: string;
  cwd: string;
  createdAt: string;
  /** Latest resumable conversation ref per provider. */
  refs: Partial<Record<ProviderId, string>>;
  /** Provider that ran the most recent turn, so a switch can be detected. */
  lastProvider?: ProviderId;
}

export interface StoredSummary {
  text: string;
  by: ProviderId;
  /** Turns the summary already covers; the rest still travel verbatim. */
  covers: number;
}

export function sessionsDir(cwd: string): string {
  return join(cwd, '.flick', 'sessions');
}

export class SessionLog {
  readonly id: string;
  readonly path: string;
  private header: SessionHeader;
  private summary: StoredSummary | null = null;

  private constructor(id: string, cwd: string, header: SessionHeader) {
    this.id = id;
    this.path = join(sessionsDir(cwd), `${id}.jsonl`);
    this.header = header;
  }

  static create(cwd: string): SessionLog {
    const id = randomUUID();
    mkdirSync(sessionsDir(cwd), { recursive: true });
    const header: SessionHeader = {
      kind: 'header',
      id,
      cwd,
      createdAt: new Date().toISOString(),
      refs: {},
    };
    const log = new SessionLog(id, cwd, header);
    log.write(header);
    return log;
  }

  static open(cwd: string, id: string): SessionLog | null {
    const path = join(sessionsDir(cwd), `${id}.jsonl`);
    if (!existsSync(path)) return null;

    // Replay the file so refs, active provider and summary reflect the newest values,
    // not whatever the header said when the session began.
    let header: SessionHeader | null = null;
    let summary: StoredSummary | null = null;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.kind === 'header') header = entry;
        else if (entry.kind === 'refs' && header) header.refs = { ...header.refs, ...entry.refs };
        else if (entry.kind === 'provider' && header) header.lastProvider = entry.provider;
        else if (entry.kind === 'summary') summary = entry.summary;
      } catch {
        // A truncated final line is expected if flick was killed mid-write. Skip it.
      }
    }
    if (!header) return null;

    const log = new SessionLog(id, cwd, header);
    log.summary = summary;
    return log;
  }

  /** Most recently modified session in this workspace, for `flick --continue`. */
  static async latest(cwd: string): Promise<string | null> {
    const dir = sessionsDir(cwd);
    const files = await readdir(dir).catch(() => [] as string[]);
    let newest: { id: string; mtime: number } | null = null;
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const info = await stat(join(dir, file)).catch(() => null);
      if (!info) continue;
      if (!newest || info.mtimeMs > newest.mtime) {
        newest = { id: file.replace(/\.jsonl$/, ''), mtime: info.mtimeMs };
      }
    }
    return newest?.id ?? null;
  }

  refFor(provider: ProviderId): string | undefined {
    return this.header.refs[provider];
  }

  setRef(provider: ProviderId, ref: string): void {
    if (!ref || this.header.refs[provider] === ref) return;
    this.header.refs[provider] = ref;
    this.write({ kind: 'refs', refs: { [provider]: ref } });
  }

  /** Provider that ran the most recent turn. Undefined on a brand-new session. */
  lastProvider(): ProviderId | undefined {
    return this.header.lastProvider;
  }

  setLastProvider(provider: ProviderId): void {
    if (this.header.lastProvider === provider) return;
    this.header.lastProvider = provider;
    this.write({ kind: 'provider', provider, at: Date.now() });
  }

  getSummary(): StoredSummary | null {
    return this.summary;
  }

  setSummary(summary: StoredSummary): void {
    this.summary = summary;
    this.write({ kind: 'summary', summary, at: Date.now() });
  }

  /** Record what the user asked, so the transcript has both sides of the dialogue. */
  recordPrompt(text: string, provider: ProviderId): void {
    this.write({ kind: 'prompt', text, provider, at: Date.now() });
  }

  /** Append any record. Synchronous on purpose so a crash still leaves a usable log. */
  write(entry: unknown): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}
