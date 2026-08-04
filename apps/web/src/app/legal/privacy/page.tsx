import type { Metadata } from 'next';
import { SITE, LEGAL_UPDATED } from '../../site';

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE.product}`,
  description: `What ${SITE.product} collects, and what never leaves your machine.`,
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-zinc-500">Last updated: {LEGAL_UPDATED}</p>

      <p>
        <strong>{SITE.legalName}</strong>, a sole trader in {SITE.country}, is the data
        controller for {SITE.product}. This page describes what we collect and, just as
        importantly, what we do not.
      </p>

      <h2>The short version</h2>
      <p>
        {SITE.product} is a program that runs on your computer. Your code, your prompts and
        your session history stay there. The only thing the application ever sends to us is
        a licence key, and only when you type one in.
      </p>

      <h2>What stays on your machine</h2>
      <p>
        These are written to disk on your own computer and are never transmitted to us:
      </p>
      <ul>
        <li>
          <strong>Session transcripts</strong> — every prompt and reply, stored as JSONL
          files under <code>.shadow/sessions/</code> in your project.
        </li>
        <li>
          <strong>Token and cost counters</strong> — kept in <code>~/.shadow/usage.json</code>.
          The &ldquo;quota tracker&rdquo; reads that local file; it does not report usage to us.
        </li>
        <li>
          <strong>Your licence</strong> — stored encrypted in{' '}
          <code>~/.shadow/license.json</code>.
        </li>
        <li>
          <strong>Provider credentials</strong> — we never see or store these.{' '}
          {SITE.product} reuses the logins the <code>claude</code> and <code>agy</code>{' '}
          tools already keep on your machine, and only checks whether such a file exists,
          never its contents.
        </li>
      </ul>
      <p>
        Our session viewer on this website parses the file you open entirely inside your
        browser tab. Nothing is uploaded — the page has no server to upload it to.
      </p>

      <h2>What we do collect</h2>
      <p>
        <strong>Licence validation.</strong> When you activate PRO, the application sends
        your licence key to our server so we can confirm it is valid. The request contains
        the key and nothing else — no code, no prompts, no filenames, no identifiers about
        your machine.
      </p>
      <p>
        <strong>Purchase details.</strong> When you buy PRO, our payment processor tells us
        your subscription identifier, its status and billing period, and where provided,
        your email address. We store these so a key can be issued and kept in step with
        your subscription. We never receive your card details.
      </p>

      <h2>Data your AI providers receive</h2>
      <p>
        This is the part worth understanding clearly. When you send a prompt,{' '}
        {SITE.product} passes it to whichever provider you selected — Anthropic or Google —
        along with the file contents and command output that agent needs. That data goes
        directly from your machine to them, under the account you already hold with them
        and under <em>their</em> privacy policies. It does not pass through us, and we
        never see it.
      </p>

      <h2>Why we are allowed to hold it</h2>
      <p>
        Licence and purchase data is processed to perform our contract with you: without it
        we cannot tell whether your subscription is active. We keep it while your
        subscription lives and for as long afterwards as tax and accounting rules require,
        then delete it.
      </p>

      <h2>Who else is involved</h2>
      <ul>
        <li>
          <strong>Paddle.com Market Ltd</strong> — merchant of record; handles payment and
          tax, and holds the billing details we never see.
        </li>
        <li>
          <strong>Cloudflare</strong> — hosts the licence service and its database.
        </li>
        <li>
          <strong>Vercel</strong> — hosts this website.
        </li>
      </ul>
      <p>We do not sell personal data, and we do not use it for advertising.</p>

      <h2>Your rights</h2>
      <p>
        You can ask us for a copy of what we hold about you, ask us to correct it, or ask
        us to delete it. Write to{' '}
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> and we will respond
        within 30 days. Deleting your licence record ends your access to paid features, so
        cancel your subscription first if that is what you intend.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the date above changes with it. Material changes to how we
        handle your data will be announced before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
      </p>
    </>
  );
}
