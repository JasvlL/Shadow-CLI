import type { Metadata } from 'next';
import Link from 'next/link';
import { Viewer } from './Viewer';

export const metadata: Metadata = {
  title: 'Session viewer — Shadow',
  description:
    'Read a Shadow session transcript in your browser. Everything is parsed locally; no session ever leaves your machine.',
};

export default function SessionsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#050505] text-white selection:bg-[#f0f] selection:text-white">
      <div className="fixed top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-fuchsia-900/20 rounded-full blur-[120px] pointer-events-none -z-10"></div>

      <nav className="flex items-center justify-between p-6 max-w-5xl mx-auto w-full z-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#f0f] glow-magenta"></div>
          <span className="text-xl font-bold tracking-tight">Shadow CLI</span>
        </Link>
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-white transition"
        >
          ← Back
        </Link>
      </nav>

      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-12 z-10">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">Session viewer</h1>
        <p className="text-zinc-400 mb-3 max-w-2xl leading-relaxed">
          Shadow keeps every session as a JSONL log under{' '}
          <code className="text-zinc-300">.shadow/sessions/</code> in your project. Open one
          here to read it as a conversation.
        </p>
        <p className="text-sm text-zinc-500 mb-10 max-w-2xl">
          Your file is parsed entirely in this browser tab — it is never uploaded, and this
          page has no server to upload it to.
        </p>

        <Viewer />
      </main>

      <footer className="py-8 text-center text-zinc-600 text-sm border-t border-zinc-900 z-10">
        <p>© 2026 Shadow CLI. All rights reserved.</p>
      </footer>
    </div>
  );
}
