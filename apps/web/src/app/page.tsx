/**
 * Paddle checkout link, set in the Vercel dashboard once the product exists.
 *
 * Read at build time so connecting checkout is an environment change, not a deploy of
 * new code — and so the button degrades to "opening soon" instead of a dead link while
 * the value is missing.
 */
const CHECKOUT_URL = process.env.NEXT_PUBLIC_PADDLE_CHECKOUT_URL;

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[#050505] text-white selection:bg-[#f0f] selection:text-white">
      {/* Background Glow */}
      <div className="fixed top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-fuchsia-900/30 rounded-full blur-[120px] pointer-events-none -z-10"></div>

      {/* Navigation */}
      <nav className="flex items-center justify-between p-6 max-w-6xl mx-auto w-full z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#f0f] glow-magenta"></div>
          <span className="text-xl font-bold tracking-tight">Shadow CLI</span>
        </div>
        <div className="flex gap-6 items-center">
          <a href="#features" className="text-sm text-zinc-400 hover:text-white transition">Features</a>
          <a href="#pricing" className="text-sm text-zinc-400 hover:text-white transition">Pricing</a>
          <a href="/sessions" className="text-sm text-zinc-400 hover:text-white transition">Sessions</a>
          <a href="https://github.com/JasvlL/Shadow-CLI" target="_blank" rel="noreferrer" className="text-sm font-medium border border-zinc-800 px-4 py-2 rounded-full hover:bg-zinc-800 transition">GitHub</a>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex flex-col items-center justify-center flex-1 px-6 pt-24 pb-12 text-center z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 text-xs font-medium border rounded-full text-[#f0f] border-[#f0f]/30 bg-[#f0f]/10 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f0f] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#f0f]"></span>
          </span>
          v0.1.0 is now live
        </div>

        <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight sm:text-7xl mb-8 leading-tight">
          The Ultimate Agentic <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f0f] to-purple-400 text-glow">
            Orchestrator
          </span> for your Terminal
        </h1>

        <p className="max-w-2xl text-lg text-zinc-400 mb-10 leading-relaxed">
          Stop context-switching. Delegate tasks across Claude, Gemini, and local models seamlessly from your CLI. Keep your flow unbroken.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full max-w-md">
          <a
            href="#pricing"
            className="w-full sm:w-auto px-8 py-4 text-sm font-bold text-black bg-[#f0f] rounded-full glow-magenta hover:scale-105 transition-transform"
          >
            Get PRO - $9.99/mo
          </a>
          <div className="flex items-center w-full sm:w-auto gap-3 px-6 py-4 text-sm font-mono text-zinc-300 border border-zinc-800 rounded-full bg-zinc-900/50 backdrop-blur-sm hover:border-zinc-700 transition">
            <span className="text-zinc-500">$</span>
            <span>npm i -g @jasvll/shadow-cli</span>
          </div>
        </div>

        {/* Demo Terminal Mockup */}
        <div className="w-full max-w-4xl mt-20 border border-zinc-800 rounded-xl bg-[#09090b] shadow-2xl overflow-hidden relative">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-[#0c0c0e]">
            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
            <div className="mx-auto text-xs font-mono text-zinc-500">shadow</div>
          </div>
          <div className="p-6 font-mono text-sm text-left leading-relaxed text-zinc-300 h-[300px] flex flex-col gap-2">
            <div><span className="text-[#f0f]">❯</span> shadow</div>
            <div className="text-zinc-500">Loading agents...</div>
            <div>
              <span className="text-cyan-400">◆ Welcome to Shadow v0.1.0</span>
            </div>
            <div>model     <span className="text-white">sonnet on claude</span></div>
            <br />
            <div><span className="text-[#f0f]">❯</span> /usage</div>
            <div><span className="text-[#f0f] font-bold">💎 SHADOW USAGE TRACKER (PRO)</span></div>
            <div>Claude cost (this session): <span className="text-white">$0.0042</span></div>
            <div>Agy cost (this session): <span className="text-white">$0.0011</span></div>
            <div className="text-zinc-500">Live API quota sync active.</div>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 max-w-6xl mx-auto w-full z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Built for 10x Developers</h2>
          <p className="text-zinc-400 max-w-2xl mx-auto">Everything you need to orchestrate multiple AI models from the comfort of your terminal.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-900/20 backdrop-blur-sm hover:border-zinc-700 transition">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-2xl mb-6">🔄</div>
            <h3 className="text-xl font-bold mb-3">Multi-Provider Handoff</h3>
            <p className="text-zinc-400 leading-relaxed">Claude ran out of quota? No problem. Shadow automatically hands off your entire context to Gemini to finish the job without skipping a beat.</p>
          </div>
          <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-900/20 backdrop-blur-sm hover:border-zinc-700 transition">
            <div className="w-12 h-12 rounded-lg bg-pink-500/10 flex items-center justify-center text-2xl mb-6">🎨</div>
            <h3 className="text-xl font-bold mb-3">Beautiful TUI</h3>
            <p className="text-zinc-400 leading-relaxed">Built with Ink. A responsive, dynamic, and gorgeous terminal user interface that feels like a modern web app directly in your console.</p>
          </div>
          <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-900/20 backdrop-blur-sm hover:border-zinc-700 transition">
            <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center text-2xl mb-6">📊</div>
            <h3 className="text-xl font-bold mb-3">Advanced Quota Tracking</h3>
            <p className="text-zinc-400 leading-relaxed">PRO Exclusive. See exactly how much your AI requests cost and when your API limits reset, updated in real-time inside your terminal.</p>
          </div>
          <div className="p-8 rounded-2xl border border-zinc-800 bg-zinc-900/20 backdrop-blur-sm hover:border-zinc-700 transition">
            <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center text-2xl mb-6">🔒</div>
            <h3 className="text-xl font-bold mb-3">Secure by Design</h3>
            <p className="text-zinc-400 leading-relaxed">Your API keys never leave your machine. Shadow PRO encrypts your license locally using military-grade AES-256 machine-specific fingerprints.</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 px-6 max-w-5xl mx-auto w-full z-10 border-t border-zinc-900">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Simple, Transparent Pricing</h2>
          <p className="text-zinc-400 max-w-2xl mx-auto">Upgrade to unlock the full potential of your agentic terminal.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free */}
          <div className="p-8 rounded-3xl border border-zinc-800 bg-zinc-900/10 flex flex-col">
            <h3 className="text-xl font-semibold mb-2">Shadow Free</h3>
            <div className="text-4xl font-bold mb-6">$0 <span className="text-lg text-zinc-500 font-normal">forever</span></div>
            <ul className="flex-1 space-y-4 mb-8 text-zinc-400">
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Switch provider mid-session, keeping context</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Every model on the plans you sign in to</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Permission gate, skills and project rules</li>
              <li className="flex items-center gap-3"><span className="text-green-500">✓</span> Session history and transcript export</li>
              <li className="flex items-center gap-3 opacity-30"><span className="text-zinc-600">✕</span> Multi-agent delegation</li>
              <li className="flex items-center gap-3 opacity-30"><span className="text-zinc-600">✕</span> Live quota &amp; cost tracker</li>
            </ul>
            <div className="w-full py-3 text-center rounded-xl border border-zinc-800 text-zinc-400 bg-zinc-900/50">
              Free forever
            </div>
          </div>

          {/* PRO */}
          <div className="p-8 rounded-3xl border-2 border-[#f0f] bg-gradient-to-b from-[#f0f]/10 to-transparent flex flex-col relative transform md:-translate-y-4 shadow-[0_0_40px_rgba(255,0,255,0.1)]">
            <div className="absolute top-0 right-8 transform -translate-y-1/2 bg-[#f0f] text-black text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
              Recommended
            </div>
            <h3 className="text-xl font-semibold mb-2 text-white">Shadow PRO</h3>
            <div className="text-4xl font-bold mb-6 text-white">$9.99 <span className="text-lg text-zinc-400 font-normal">/mo</span></div>
            <ul className="flex-1 space-y-4 mb-8 text-zinc-300">
              <li className="flex items-center gap-3"><span className="text-[#f0f]">✓</span> Everything in Free</li>
              <li className="flex items-center gap-3"><span className="text-[#f0f]">✓</span> <strong className="text-white">Multi-agent delegation</strong> — run subagents in parallel, across both plans</li>
              <li className="flex items-center gap-3"><span className="text-[#f0f]">✓</span> <strong className="text-white">Live quota &amp; cost tracker</strong> for both subscriptions</li>
              <li className="flex items-center gap-3"><span className="text-[#f0f]">✓</span> Priority support</li>
            </ul>
            {CHECKOUT_URL ? (
              <a
                href={CHECKOUT_URL}
                className="w-full py-3 text-center rounded-xl bg-[#f0f] text-black font-bold glow-magenta hover:bg-fuchsia-500 transition"
              >
                Upgrade to PRO
              </a>
            ) : (
              // No dead "buy" button: until checkout is connected, say so rather than
              // taking a click that goes nowhere.
              <div className="w-full py-3 text-center rounded-xl border border-[#f0f]/40 text-[#f0f] font-semibold">
                Checkout opening soon
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 text-center text-zinc-600 text-sm border-t border-zinc-900 z-10">
        <p>© 2026 Shadow CLI. All rights reserved.</p>
      </footer>
    </div>
  );
}
