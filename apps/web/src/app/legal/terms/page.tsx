import type { Metadata } from 'next';
import { SITE, LEGAL_UPDATED } from '../../site';

export const metadata: Metadata = {
  title: `Terms of Service — ${SITE.product}`,
  description: `The terms under which ${SITE.product} is sold and used.`,
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-sm text-zinc-500">Last updated: {LEGAL_UPDATED}</p>

      <h2>1. Who you are contracting with</h2>
      <p>
        {SITE.product} is operated by <strong>{SITE.legalName}</strong>, a sole trader
        established in {SITE.country}. In these terms, &ldquo;we&rdquo; and
        &ldquo;us&rdquo; mean {SITE.legalName}, and &ldquo;you&rdquo; means the person or
        organisation using {SITE.product}.
      </p>
      <p>
        Payments are processed by <strong>Paddle.com Market Ltd</strong>, which acts as the
        merchant of record and reseller for all purchases. Your order is therefore also
        subject to Paddle&rsquo;s own terms, and your card statement will show Paddle
        rather than us.
      </p>

      <h2>2. What the software does</h2>
      <p>
        {SITE.product} is a terminal application that coordinates AI coding agents running
        on <em>your own</em> third-party subscriptions — currently Anthropic&rsquo;s Claude
        and Google&rsquo;s Antigravity.
      </p>
      <p>
        <strong>We do not resell AI model access.</strong> {SITE.product} holds no
        credentials of its own; it uses the ones those tools have already stored on your
        machine. You need your own active accounts with those providers, and your use of
        them is governed by their terms, not ours. Their pricing, quotas and availability
        are outside our control.
      </p>

      <h2>3. Free and paid tiers</h2>
      <ul>
        <li>
          <strong>Free</strong> — switching providers mid-session, every model on the plans
          you sign in to, the permission gate, skills, project rules, session history and
          transcript export.
        </li>
        <li>
          <strong>PRO</strong> ({SITE.proPrice}/month) — everything in Free, plus
          multi-agent delegation and the live quota and cost tracker.
        </li>
      </ul>
      <p>
        A PRO licence is for one person. You may install and use it on as many machines as
        you personally work on. Sharing a licence key with others, or publishing it, is not
        permitted and may result in the key being revoked.
      </p>

      <h2>4. Subscriptions, renewal and cancellation</h2>
      <p>
        PRO is billed monthly in advance and renews automatically until cancelled. You may
        cancel at any time through the link in your purchase receipt or by writing to{' '}
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>. On cancellation
        your licence stays active until the end of the period you have already paid for,
        after which the software returns to the Free tier. Cancelling does not delete
        anything on your computer.
      </p>
      <p>
        Refunds are covered separately in our <a href="/legal/refunds">Refund Policy</a>.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>share, resell or publish your licence key;</li>
        <li>
          attempt to bypass licence validation, or use {SITE.product} to access paid
          features without a valid licence;
        </li>
        <li>use the software to break the law, or to breach the terms of Anthropic, Google or any other provider it connects to.</li>
      </ul>

      <h2>6. The software is a tool, and it can be wrong</h2>
      <p>
        {SITE.product} runs AI agents that read, write and delete files, and that can
        execute commands on your computer. It includes a permission gate that asks before
        anything destructive, but{' '}
        <strong>
          you remain responsible for what you approve and for keeping backups of your work.
        </strong>{' '}
        AI output can be incorrect. Review changes before you rely on them.
      </p>
      <p>
        The software is provided &ldquo;as is&rdquo;, without warranty of any kind. To the
        fullest extent permitted by law, we are not liable for lost data, lost profits, or
        any indirect or consequential loss. Where liability cannot be excluded, it is
        limited to the amount you paid us in the twelve months before the claim.
      </p>
      <p>
        Nothing here limits rights you have as a consumer that cannot be limited by
        agreement.
      </p>

      <h2>7. Availability</h2>
      <p>
        Licence validation depends on a service we host. We aim to keep it available but do
        not guarantee uninterrupted access. Features may change as the product develops; if
        we remove something material from the paid tier, you may cancel and request a
        pro-rated refund for the unused period.
      </p>

      <h2>8. Changes to these terms</h2>
      <p>
        We may update these terms. The date at the top shows the current version. If a
        change materially reduces your rights, it applies from your next renewal rather
        than immediately, so you can cancel first.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These terms are governed by the laws of {SITE.country}. If you are a consumer, you
        keep the protection of the mandatory laws of your own country of residence.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
    </>
  );
}
