/**
 * A lead (what Google says about a business) → the facts file the site generator builds from.
 * Only public listing data goes in; everything else is left for the owner to give us.
 */
import { TRADES } from './score.mjs'

export function fromLead(lead) {
  return {
    name: lead.name,
    trade: lead.trade,
    type: TRADES[lead.trade]?.schema ?? 'HomeAndConstructionBusiness',
    telephone: lead.phone,
    areaServed: lead.city ? [lead.city] : [],
    address: { addressLocality: lead.city, addressRegion: lead.state, postalCode: lead.zip },
    showAddress: false,
    state: lead.state,
    hoursText: lead.hours ?? null,
    google: lead.rating ? { rating: lead.rating, reviews: lead.reviews, url: lead.mapsUrl } : null,
  }
}
