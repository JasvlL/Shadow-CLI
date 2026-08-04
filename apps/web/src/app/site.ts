/**
 * The details that have to be legally accurate and appear in several places.
 *
 * Paddle's review compares the seller name on your account against the name published on
 * the site, so `legalName` must match your Paddle registration exactly — not a brand
 * name. Fill these in before submitting for review.
 */
export const SITE = {
  /** Product/brand name. */
  product: 'Shadow CLI',

  /**
   * Your full legal name as registered with Paddle. As a sole trader this is your own
   * name as it appears on your ID, not a company name.
   */
  legalName: 'Jeferson Zelaya',

  /** Country of establishment, stated for tax and consumer-rights purposes. */
  country: 'Costa Rica',

  /** Domain, once you own one. Used for canonical links and the contact address. */
  domain: 'shadowcli.dev',

  /** Support/contact inbox. Paddle expects a working address on the site. */
  supportEmail: 'support@shadowcli.dev',

  /** Days a customer has to request a no-questions-asked refund. */
  refundDays: 14,

  /** Monthly price of the paid tier, as shown on the pricing section. */
  proPrice: '$9.99',

  repo: 'https://github.com/JasvlL/Shadow-CLI',
} as const;

/** Last time the legal pages changed, shown on each of them. */
export const LEGAL_UPDATED = 'August 4, 2026';
