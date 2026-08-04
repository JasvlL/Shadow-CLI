import Link from 'next/link';
import { SITE } from '../site';

/**
 * Shared shell for the legal pages.
 *
 * Prose styling lives here rather than in each page so the three documents cannot drift
 * apart visually — a policy page that looks improvised reads as untrustworthy, and
 * Paddle's reviewer sees these before any customer does.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-[#050505] text-white selection:bg-[#f0f] selection:text-white">
      <div className="fixed top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-fuchsia-900/15 rounded-full blur-[120px] pointer-events-none -z-10"></div>

      <nav className="flex items-center justify-between p-6 max-w-3xl mx-auto w-full z-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#f0f] glow-magenta"></div>
          <span className="text-xl font-bold tracking-tight">{SITE.product}</span>
        </Link>
        <Link href="/" className="text-sm text-zinc-400 hover:text-white transition">
          ← Back
        </Link>
      </nav>

      <main
        className="flex-1 w-full max-w-3xl mx-auto px-6 py-12 z-10
          [&_h1]:text-4xl [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:mb-2
          [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-3
          [&_p]:text-zinc-400 [&_p]:leading-relaxed [&_p]:mb-4
          [&_ul]:text-zinc-400 [&_ul]:mb-4 [&_ul]:space-y-2 [&_ul]:list-disc [&_ul]:pl-6
          [&_li]:leading-relaxed
          [&_a]:text-[#f0f] [&_a]:underline [&_a]:underline-offset-2
          [&_strong]:text-white
          [&_code]:text-zinc-300 [&_code]:bg-zinc-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded"
      >
        {children}
      </main>

      <footer className="py-8 text-center text-zinc-600 text-sm border-t border-zinc-900 z-10">
        <div className="flex flex-wrap justify-center gap-6 mb-4">
          <Link href="/legal/terms" className="hover:text-zinc-300 transition">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-zinc-300 transition">Privacy</Link>
          <Link href="/legal/refunds" className="hover:text-zinc-300 transition">Refunds</Link>
          <a href={`mailto:${SITE.supportEmail}`} className="hover:text-zinc-300 transition">Contact</a>
        </div>
        <p>© 2026 {SITE.legalName}. All rights reserved.</p>
      </footer>
    </div>
  );
}
