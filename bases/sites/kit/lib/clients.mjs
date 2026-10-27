/**
 * Paying clients, kept in the kit's store so one can be added without redeploying the kit.
 *
 *   clients/c/<id>      the record: name, plan, price, token, origins, agreement, payment, intake
 *   clients/t/<token>   → id, for the client's own links (/c/<token>)
 *
 * The token is the only thing in a client's links: 32 random hex characters, unguessable.
 * A client record also stands in for a site (for the lead form) once it has origins.
 */
import { store } from './store.mjs'

const S = () => store('clients')

export async function getClient(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,48}$/.test(id)) return null
  return S().get(`c/${id}`, { type: 'json' })
}

export async function byToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return null
  const ref = await S().get(`t/${token}`, { type: 'json' })
  return ref ? getClient(ref.id) : null
}

export async function putClient(rec) {
  await S().setJSON(`c/${rec.id}`, rec)
  if (rec.token) await S().setJSON(`t/${rec.token}`, { id: rec.id })
  return rec
}

/** The lead form's view of a client: only once it's published with its origins. */
export async function clientSite(id) {
  const c = await getClient(id)
  if (!c?.origins?.length) return null
  return {
    id: c.id,
    name: c.name,
    origins: c.origins,
    thanks: c.thanks ?? "Thanks, we've got your details and will call you back soon.",
    contact: c.contact ?? {},
    notifyEmail: c.notifyEmail ?? null,
    client: true,
  }
}
