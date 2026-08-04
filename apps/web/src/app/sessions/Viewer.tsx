'use client';

import { useCallback, useMemo, useState } from 'react';
import { parseSessionFile, statsFor, type TurnRecord } from './parse';

function formatWhen(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/30">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Turn({ turn }: { turn: TurnRecord }) {
  const isUser = turn.role === 'user';
  return (
    <div
      className={`p-5 rounded-2xl border ${
        isUser
          ? 'border-zinc-800 bg-zinc-900/40'
          : 'border-[#f0f]/20 bg-gradient-to-b from-[#f0f]/5 to-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-xs font-bold uppercase tracking-wide ${
            isUser ? 'text-zinc-400' : 'text-[#f0f]'
          }`}
        >
          {isUser ? 'You' : 'Assistant'}
        </span>
        {!isUser && turn.provider && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-zinc-800 text-zinc-400">
            {turn.provider}
          </span>
        )}
      </div>

      {turn.text.trim() && (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-300 leading-relaxed">
          {turn.text.trim()}
        </pre>
      )}

      {turn.tools.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {turn.tools.map((tool, i) => (
            <span
              key={i}
              className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 max-w-full truncate"
              title={tool.summary}
            >
              {tool.summary}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Viewer() {
  const [turns, setTurns] = useState<TurnRecord[] | null>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const load = useCallback(async (file: File) => {
    setError('');
    try {
      const text = await file.text();
      const parsed = parseSessionFile(text);
      if (parsed.length === 0) {
        setError('No turns found. Expected a .jsonl session log or a /export json file.');
        return;
      }
      setTurns(parsed);
      setFilename(file.name);
    } catch {
      setError('Could not read that file.');
    }
  }, []);

  const stats = useMemo(() => (turns ? statsFor(turns) : null), [turns]);

  if (!turns) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void load(file);
        }}
        className={`rounded-3xl border-2 border-dashed p-16 text-center transition ${
          dragging ? 'border-[#f0f] bg-[#f0f]/5' : 'border-zinc-800 bg-zinc-900/20'
        }`}
      >
        <p className="text-lg font-medium mb-2">Drop a session file here</p>
        <p className="text-sm text-zinc-500 mb-6">
          A <code className="text-zinc-400">.jsonl</code> from{' '}
          <code className="text-zinc-400">.shadow/sessions/</code>, or the file{' '}
          <code className="text-zinc-400">/export</code> wrote.
        </p>

        <label className="inline-block px-6 py-3 rounded-full bg-[#f0f] text-black font-bold cursor-pointer glow-magenta hover:bg-fuchsia-500 transition">
          Choose a file
          <input
            type="file"
            accept=".jsonl,.json,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void load(file);
            }}
          />
        </label>

        {error && <p className="mt-6 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="font-mono text-sm text-zinc-400 truncate">{filename}</div>
        <button
          onClick={() => {
            setTurns(null);
            setFilename('');
          }}
          className="text-sm px-4 py-2 rounded-full border border-zinc-800 text-zinc-300 hover:bg-zinc-900 transition"
        >
          Open another
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat label="Turns" value={stats.turns} />
          <Stat label="Tool calls" value={stats.toolCalls} />
          <Stat label="Plans used" value={stats.providers.join(', ') || '—'} />
          <Stat label="Started" value={formatWhen(stats.startedAt)} />
        </div>
      )}

      <div className="space-y-4">
        {turns.map((turn, i) => (
          <Turn key={i} turn={turn} />
        ))}
      </div>
    </div>
  );
}
