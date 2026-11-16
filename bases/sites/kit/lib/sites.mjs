/**
 * The sites this kit serves. Add one: a module in sites/ and a line here.
 */
import automaton from '../sites/automaton.mjs'
import walkthroughs from '../sites/walkthroughs.mjs'

const SITES = { automaton, walkthroughs }

export const getSite = (id) => (typeof id === 'string' && Object.hasOwn(SITES, id) ? SITES[id] : null)

/** The booking link for a site: BOOKING_URL_<SITE> (e.g. a Cal.com link), else none yet. */
export function bookingFor(site) {
  const url = process.env[`BOOKING_URL_${site.id.toUpperCase()}`] || site.booking?.url || null
  return url && /^https:\/\//.test(url) ? { url, label: site.booking?.label ?? 'Book a call' } : null
}

/** What the widget may know about a site: never its instructions or anything private. */
export const publicConfig = (site) => ({
  id: site.id,
  name: site.name,
  accent: site.accent,
  greeting: site.greeting,
  suggestions: site.suggestions,
  booking: bookingFor(site),
  contact: site.contact,
  thanks: site.thanks,
})
