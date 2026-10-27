/**
 * The website services agreement a client accepts online before paying.
 *
 * Plain language, one version per client (the plan and price are filled in), and the exact
 * text they accepted is identified by its SHA-256 (`version`), stored with their acceptance.
 * It's a template, not legal advice: Markus has it reviewed once by a lawyer and sets
 * KIT_LEGAL_NAME (Automaton's legal entity) and KIT_GOVERNING_STATE before using it.
 */
import { createHash } from 'node:crypto'

export const PLANS = {
  launch: {
    label: 'Launch',
    scope: [
      'A custom website for your business: home, services, about and contact pages, plus a privacy policy, terms of use and an accessibility statement.',
      'Built for phones first, with tap-to-call buttons, a contact form that sends your enquiries to you, and the details search engines read (your business type, area and hours).',
      'Hosting with an encrypted (HTTPS) connection, uptime monitoring, and connecting your own domain if you have one.',
      'Changes to text and photos after launch, when you ask.',
    ],
  },
  premium: {
    label: 'Premium',
    scope: [
      'Everything in Launch.',
      'An assistant on the site that answers visitors from facts you approve, and takes their details when you can\'t pick up.',
      'Calls booked from the site into your calendar.',
      'A follow-up drafted for each enquiry, for you to send.',
    ],
  },
}

const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/** Sections as [heading, paragraphs[]]; the same text is shown, hashed and stored. */
export function agreement(client) {
  const provider = process.env.KIT_LEGAL_NAME || 'Automaton'
  const state = process.env.KIT_GOVERNING_STATE || 'the state where Automaton is organized'
  const plan = PLANS[client.plan] ?? PLANS.launch
  const price = [
    `${money(client.oneTimeCents)} one time${client.oneTimeCents ? ', paid when you accept this agreement' : ''}.`,
    client.monthlyCents ? `${money(client.monthlyCents)} a month for hosting and the ${plan.label} features, starting today and charged monthly until you cancel. Cancel any time by telling us; it stops at the end of that month.` : 'No monthly fee.',
  ]
  return [
    ['Who this is between', [`This agreement is between ${provider} ("we") and ${client.name} ("you"), for the ${plan.label} website plan.`]],
    ['What we\'ll do', plan.scope],
    ['What you\'ll do', ['Give us accurate information about your business, and photos and logos that you own or have permission to use.', 'Look over the site before it goes live, and tell us what to change.']],
    ['Price', price],
    ['Timing', ['We aim to have your site live within two business days of receiving your information through the intake form. Changes before launch are unlimited.']],
    ['What\'s yours', ['Your business information, text, photos and logo stay yours. If you leave, we\'ll give you your content. Your domain name is yours; we only connect it.']],
    ['Visitors\' information', ['Messages people send through your site are passed to you and kept only to deliver them to you and keep a record of them. We don\'t sell or share them, we protect them with access controls and encryption in transit, and we\'ll tell you promptly if they\'re ever exposed.']],
    ['Refunds', ['If we can\'t deliver the site described here, we refund what you paid. Once your site is live, the one-time fee isn\'t refundable.']],
    ['Limits', [`Our total responsibility under this agreement is limited to what you paid us in the twelve months before a claim. Neither of us is responsible for indirect losses, such as lost profits. Nothing here limits rights you have by law that can't be limited.`]],
    ['The law', [`This agreement is governed by the laws of ${state}.`]],
    ['Signing electronically', ['Typing your name and clicking "I agree" signs this agreement, the same as signing on paper. You can open this page again to see the agreement you signed.']],
  ]
}

export const versionOf = (sections) => createHash('sha256').update(JSON.stringify(sections)).digest('hex')
