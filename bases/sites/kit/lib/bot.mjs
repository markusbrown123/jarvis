/**
 * The site assistant: answers a visitor from the site's own facts, and says
 * when to offer a call or the contact form.
 *
 * Claude Opus 5.5 at low effort (a chat reply, not a hard problem), with
 * server-side fallbacks on so a safety decline is re-run on another model
 * rather than leaving the visitor with nothing. The reply comes back as JSON
 * (reply + action) so the widget knows what to show next.
 */
import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-opus-5-5'

/** Swapped for a stand-in under test. */
export const deps = { client: null }

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'What to say to the visitor: plain text, at most about 70 words.' },
    action: {
      type: 'string',
      enum: ['none', 'booking', 'lead_form'],
      description: 'booking: offer to book a call now. lead_form: ask for their name and contact so the team can follow up. none: just the reply.',
    },
  },
  required: ['reply', 'action'],
  additionalProperties: false,
}

export function systemPrompt(site, { canBook }) {
  return `You are the assistant on ${site.name}'s website, talking with a visitor. Your job is to answer their questions about ${site.name} honestly and briefly, and to help the ones who are interested get in touch.

Everything you know about ${site.name} is below. Answer only from it. If they ask something it doesn't cover — a price that isn't listed, a date, a guarantee, anything about a specific job — say you don't want to guess and offer to have the team follow up. Never invent prices, timelines, features, results or reviews, and never promise anything that isn't written here.

<facts>
${site.facts}
</facts>

How to talk: warm, plain and short — two to four sentences, no lists unless they ask for detail, no markdown. Ask at most one question at a time. If they write in another language, answer in it.

When to offer the next step (the "action" field):
- "${canBook ? 'booking' : 'lead_form'}" when they show real interest — they ask how to start, about their own project, about price for their case, or say they want it.${canBook ? '\n- "lead_form" when they would rather be contacted than book, or they share a phone number or email.' : ''}
- "none" otherwise. Don't push: offer the next step once, then only if they ask again.

Never ask for payment details, passwords or anything sensitive. You can't send messages, book on their behalf or see their calendar; the buttons the site shows do that. If someone is rude or off-topic, steer back to ${site.name} politely.`
}

/** Messages as the API takes them: user/assistant turns of plain text, starting with the visitor. */
export function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 24) return null
  const out = []
  let total = 0
  for (const m of raw) {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') return null
    const content = m.content.trim().slice(0, 2000)
    if (!content) return null
    total += content.length
    out.push({ role: m.role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  if (!out.length || out.at(-1).role !== 'user' || total > 16_000) return null
  return out
}

export async function reply(site, messages, { canBook }) {
  const client = deps.client ?? new Anthropic()
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: systemPrompt(site, { canBook }), cache_control: { type: 'ephemeral' } }],
    messages,
  })
  if (res.stop_reason === 'refusal') return { reply: "I can't help with that here — but the team can. Leave your details and they'll get back to you.", action: 'lead_form' }
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  try {
    const out = JSON.parse(text)
    const action = ['none', 'booking', 'lead_form'].includes(out.action) ? out.action : 'none'
    return { reply: String(out.reply ?? '').slice(0, 1200), action: action === 'booking' && !canBook ? 'lead_form' : action }
  } catch {
    return { reply: 'Sorry — I lost my train of thought. Could you ask that again?', action: 'none' }
  }
}
