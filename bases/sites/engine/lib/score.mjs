/**
 * Which businesses are worth a call, and why — every point comes with a reason in words,
 * because the reasons are what Markus says on the phone.
 *
 * score = need (0–50: how badly they need a site) + value (0–32: established enough to pay,
 * and the job is high-ticket) + fit (0–12: a trade we build for, in the area we're working).
 * Excluded outright: closed, no phone, a chain or franchise, on the Do-Not-Call list, already
 * called. A business we can't reach or shouldn't call never makes the shortlist.
 */

// Search phrase, how we name the trade, its ticket size (1–3) and its schema.org type.
export const TRADES = {
  roofing: { search: 'roofing contractor', label: 'roofing', ticket: 3, schema: 'RoofingContractor' },
  hvac: { search: 'HVAC contractor', label: 'heating and air conditioning', ticket: 3, schema: 'HVACBusiness' },
  plumbing: { search: 'plumber', label: 'plumbing', ticket: 3, schema: 'Plumber' },
  electrical: { search: 'electrician', label: 'electrical', ticket: 3, schema: 'Electrician' },
  paving: { search: 'asphalt paving and sealcoating', label: 'paving and sealcoating', ticket: 3, schema: 'HomeAndConstructionBusiness' },
  remodeling: { search: 'home remodeling contractor', label: 'remodeling', ticket: 3, schema: 'GeneralContractor' },
  landscaping: { search: 'landscaping company', label: 'landscaping', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  tree: { search: 'tree service', label: 'tree service', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  concrete: { search: 'concrete contractor', label: 'concrete', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  fencing: { search: 'fence contractor', label: 'fencing', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  garagedoor: { search: 'garage door repair', label: 'garage door', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  pest: { search: 'pest control', label: 'pest control', ticket: 2, schema: 'HomeAndConstructionBusiness' },
  painting: { search: 'house painter', label: 'painting', ticket: 2, schema: 'HousePainter' },
  pressure: { search: 'pressure washing', label: 'pressure washing', ticket: 1, schema: 'HomeAndConstructionBusiness' },
  cleaning: { search: 'house cleaning service', label: 'cleaning', ticket: 1, schema: 'HomeAndConstructionBusiness' },
}

// National chains and franchises: they have a corporate site and a marketing department.
const CHAINS = /\b(roto-?rooter|mr\.? rooter|benjamin franklin|one hour (heating|air)|mister sparky|ars rescue|service experts|servpro|servicemaster|terminix|orkin|truly nolen|trugreen|lawn doctor|weed man|two men and a truck|college hunks|molly maid|merry maids|the maids|stanley steemer|chem-?dry|sears|home depot|lowe'?s|leaf ?filter|window nation|power home remodeling|bath fitter|re-?bath|mosquito joe|mosquito squad|five star painting|certapro|ace hardware|aire serv|precision (garage|door)|overhead door company of|budget blinds|neighborly|dwyer)\b/i

const NEED = { none: 50, social: 46, parked: 46, broken: 44, ok: 6 }

export function score(lead, { area = '', dnc = new Set(), contacted = new Set() } = {}) {
  const reasons = []
  const why = (pts, text) => (reasons.push({ pts, text }), pts)
  let excluded = null
  if (lead.businessStatus && lead.businessStatus !== 'OPERATIONAL') excluded = 'not operating'
  else if (!lead.phone) excluded = 'no phone number'
  else if (CHAINS.test(lead.name)) excluded = 'a chain or franchise'
  else if (dnc.has(lead.phone) || lead.stage === 'dnc') excluded = 'on the Do-Not-Call list'
  else if (contacted.has(lead.phone) && !(lead.calls ?? []).length) excluded = 'already contacted by Automaton'
  else if ((lead.calls ?? []).length && !['no_answer', 'voicemail'].includes(lead.calls.at(-1).outcome)) excluded = 'already called'

  // need
  const s = lead.site?.status
  let need
  if (!s) need = 25
  else if (s === 'weak') need = Math.min(40, 16 + 6 * (lead.site.notes?.length ?? 1))
  else need = NEED[s] ?? 6
  why(need, {
    none: 'No website at all.',
    social: 'Only a social or directory page, no site of their own.',
    parked: 'Their domain shows a parked or "coming soon" page.',
    broken: "Their website doesn't load.",
    weak: `Their site is weak: ${(lead.site?.notes ?? []).length} problems a customer would notice.`,
    ok: 'They have a reasonable site already.',
    undefined: 'Website not checked yet.',
  }[s])

  // value
  const n = lead.reviews ?? 0
  const rv = n >= 250 ? 16 : n >= 100 ? 20 : n >= 40 ? 18 : n >= 15 ? 14 : n >= 5 ? 9 : n >= 1 ? 4 : 0
  if (rv) why(rv, `${n} Google reviews${lead.rating ? ` at ${lead.rating}★` : ''}: an established business${n >= 250 ? ' (big enough that someone may already handle marketing)' : ''}.`)
  else why(0, 'No Google reviews yet: may be very new or very small.')
  if (lead.rating != null) {
    if (lead.rating >= 4.6) why(6, 'Customers love them, which a good site can show off.')
    else if (lead.rating >= 4.2) why(4, 'Well rated.')
    else if (lead.rating < 3.5) why(-8, `Rated ${lead.rating}★: reputation problems a website won't fix.`)
  }
  const t = TRADES[lead.trade]
  if (t) why(2 * t.ticket, t.ticket === 3 ? `${cap(t.label)} jobs are high-ticket: one extra job a month pays for the site.` : `${cap(t.label)} is steady repeat work.`)

  // fit
  if (t) why(6, `${cap(t.label)} is a trade we build for.`)
  if (lead.hours?.length) why(2, 'Their hours are listed: a running business.')
  if (lead.city && area.toLowerCase().includes(lead.city.toLowerCase())) why(4, `Based in ${lead.city}, the area we're working.`)

  const total = Math.max(0, Math.round(reasons.reduce((a, r) => a + r.pts, 0)))
  return { total, excluded, reasons, scoredAt: new Date().toISOString() }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
