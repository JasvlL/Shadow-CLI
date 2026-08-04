import type { Metadata } from 'next';
import { SITE, LEGAL_UPDATED } from '../../site';

export const metadata: Metadata = {
  title: `Refund Policy — ${SITE.product}`,
  description: `${SITE.refundDays}-day no-questions-asked refunds on ${SITE.product} PRO.`,
};

export default function RefundsPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p className="text-sm text-zinc-500">Last updated: {LEGAL_UPDATED}</p>

      <h2>{SITE.refundDays} days, no questions asked</h2>
      <p>
        If {SITE.product} PRO is not what you needed, write to us within{' '}
        <strong>{SITE.refundDays} days</strong> of your purchase and we will refund it in
        full. You do not have to explain why.
      </p>
      <p>
        This applies to your first payment. Because the Free tier lets you use {SITE.product}
        for as long as you like before paying, we ask that you try it there first.
      </p>

      <h2>How to request one</h2>
      <p>
        Email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> from the
        address you bought with, or use the link in your purchase receipt. Include your
        order number if you have it. We reply within two business days.
      </p>
      <p>
        Refunds are issued by <strong>Paddle</strong>, our merchant of record, to the
        original payment method. Their processing usually takes 5&ndash;10 business days
        depending on your bank.
      </p>

      <h2>Renewals</h2>
      <p>
        PRO renews monthly. To avoid the next charge, cancel before the renewal date —
        cancelling keeps your access until the end of the period you already paid for.
      </p>
      <p>
        If a renewal catches you by surprise, tell us within{' '}
        <strong>{SITE.refundDays} days</strong> of the charge and we will refund that
        month too, provided the paid features were not substantially used in that period.
      </p>

      <h2>If something is broken</h2>
      <p>
        A refund is not your only option, and often not the fastest one. If PRO is not
        working — delegation refusing to run, the tracker not showing — please tell us. It
        is usually a bug we can fix quickly. If we cannot make it work for you, you get
        your money back regardless of how long it has been.
      </p>

      <h2>What is not refundable</h2>
      <p>
        We cannot refund what you spend with Anthropic or Google. {SITE.product} runs on{' '}
        <em>your</em> subscriptions with those providers and never bills you for model
        usage; those charges are between you and them.
      </p>

      <h2>Your statutory rights</h2>
      <p>
        This policy is offered in addition to the rights you have by law, and does not
        replace them. Consumers in some countries have a statutory right to withdraw from a
        purchase; that right stands whatever this page says.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
      </p>
    </>
  );
}
