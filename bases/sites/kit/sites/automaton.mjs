/**
 * automaton.llc: what the assistant knows and how it behaves there.
 *
 * `facts` is all it may answer from — taken from the live automaton.llc page
 * (2026-10-26). Change a fact here and the assistant changes with it. The
 * booking link comes from BOOKING_URL_AUTOMATON (a Cal.com link) once there
 * is one; until then the widget offers the contact form instead.
 */
export default {
  id: 'automaton',
  name: 'Automaton',
  origins: ['https://automaton.llc', 'https://www.automaton.llc'],
  accent: '#c8ff00',
  greeting: "Hi — I'm Automaton's assistant. Ask about a website for your business, what it costs, or how fast it goes live.",
  suggestions: ['What do I get for $299?', 'How fast is it live?', 'Can it book calls for me?'],
  booking: { label: 'Book a 15-minute call' },
  contact: { phone: '(862) 325-3923', email: 'support@automaton.llc' },
  thanks: "Thanks — we've got your details and will be in touch within one business day.",
  facts: `Automaton (automaton.llc) is a small team, based at the University of Pennsylvania, building custom websites for local service businesses: plumbers, electricians, HVAC technicians, roofers, painters, landscapers, pest control, cleaning companies, contractors, locksmiths, restoration companies and more.

LAUNCH — $299, one time, no monthly fees.
- A fully custom website for the trade and service area, not a template. Mobile-first, click-to-call buttons, a contact form, SEO copy written for local searches ("[trade] in [city]"), schema markup, Google Maps, and a link to the Google Business Profile. SSL and hosting included, with uptime monitoring and basic support.
- Usually designed and ready to review within 12–24 hours of the short survey; live the same day it's approved; typically under 48 hours from survey to live.
- Unlimited revisions before launch. Nothing is charged until the owner approves the preview — if they don't want it, they don't pay. Basic text and image edits after launch are included.
- The owner owns their content (business info, copy, photos, branding). An existing domain can be connected; Automaton handles the DNS. If they leave, their content can be exported.

PREMIUM — for a business that wants its site to sell for it.
- Everything in Launch, designed to a higher bar, plus: a chat assistant like this one that answers visitors from the business's own facts; calls booked straight from the site into the owner's calendar; and follow-up written after every new lead and booking, sent only once the owner approves it.
- Premium is priced per project after a short call. No Premium price is quoted in chat.

Contact: call (862) 325-3923 or email support@automaton.llc.`,
}
