/**
 * Finding businesses: Google Places API (New), Text Search.
 *
 *   POST https://places.googleapis.com/v1/places:searchText
 *   headers X-Goog-Api-Key, X-Goog-FieldMask; body { textQuery, pageSize ≤ 20, pageToken }
 *
 * Billed per request (one page of up to 20 places) at the highest tier of any field asked
 * for; with website and phone that's about $0.032–0.035 a page, after 1,000 free a month
 * (2026 price list; check console.cloud.google.com before raising the caps). Every search
 * goes through `spend`, which refuses once the run's request cap is reached.
 */
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.regularOpeningHours',
  'nextPageToken',
].join(',')

/** `fetchImpl` is injectable for tests; nothing else here touches the network. */
export async function searchText({ key, query, pages = 3, budget, fetchImpl = fetch }) {
  if (!key) throw new Error('no Google Places key (GOOGLE_PLACES_API_KEY)')
  const out = []
  let pageToken
  for (let p = 0; p < pages; p++) {
    budget.spend(1)
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': FIELDS },
      body: JSON.stringify({ textQuery: query, pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(20000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Places ${res.status}: ${body?.error?.message ?? 'request failed'}`)
    out.push(...(body.places ?? []))
    pageToken = body.nextPageToken
    if (!pageToken) break
  }
  return out
}

/** A request cap for one run, so a loop or a typo can't run up a bill. */
export function budget({ maxRequests, usdPerRequest = 0.035 }) {
  let used = 0
  return {
    spend(n) {
      if (used + n > maxRequests) throw new Error(`Places request cap reached (${maxRequests} this run)`)
      used += n
    },
    get used() {
      return used
    },
    get usd() {
      return Math.round(used * usdPerRequest * 100) / 100
    },
  }
}

const part = (place, type, short = false) => {
  const c = (place.addressComponents ?? []).find((x) => x.types?.includes(type))
  return c ? (short ? c.shortText : c.longText) : null
}
const e164 = (p) => {
  const d = String(p ?? '').replace(/\D/g, '')
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : null
}

/** A Places result → the engine's lead record (only what Google returned; nothing guessed). */
export function toLead(place, { trade, query, area }) {
  return {
    id: `pl_${place.id}`,
    placeId: place.id,
    name: place.displayName?.text ?? '',
    trade,
    primaryType: place.primaryType ?? null,
    category: place.primaryTypeDisplayName?.text ?? null,
    phone: e164(place.internationalPhoneNumber ?? place.nationalPhoneNumber),
    phoneDisplay: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    address: place.formattedAddress ?? null,
    city: part(place, 'locality') ?? part(place, 'sublocality') ?? part(place, 'postal_town'),
    state: part(place, 'administrative_area_level_1', true),
    zip: part(place, 'postal_code'),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? 0,
    mapsUrl: place.googleMapsUri ?? null,
    hours: place.regularOpeningHours?.weekdayDescriptions ?? null,
    businessStatus: place.businessStatus ?? null,
    query,
    area,
    foundAt: new Date().toISOString(),
  }
}
