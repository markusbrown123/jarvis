# Meetings: Cal.com or Calendly

For booking discovery calls and walkthrough demos straight from the sites, with a webhook so
JARVIS can draft the follow-up. Researched 2026-10-26 from search-engine extracts of the
vendors' own pages (cal.com and calendly.com themselves couldn't be loaded from the machine
that did it). Anything marked *unconfirmed* needs a look at the live page.

## Decision: Cal.com

Embeds and webhooks work on its free plan, and its booking webhook carries the attendee and
their form answers with no follow-up API call. Calendly needs a paid plan (Standard and up) for
webhooks. Cal.com also still connects Apple/iCloud calendars; Calendly stopped new iCloud
connections in August 2024. Budget for Cal.com Teams (about $12–16 a user a month) only if a
premium client needs the Cal.com branding removed.

## What the kit relies on

- **Embed**: the event type's Embed generator (inline, floating button, or popup), loading
  `https://app.cal.com/embed/embed.js`; a plain link to the event works anywhere. Fields can be
  prefilled (`?name=&email=`). *The script URL is confirmed only by third-party guides.*
- **Webhook**: Settings → Developer → Webhooks, or per event type. Events `BOOKING_CREATED`,
  `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`. Header `X-Cal-Signature-256`: HMAC-SHA256 of the
  raw body with the webhook's secret. *The encoding isn't stated in Cal.com's docs; most sources
  say lowercase hex, one shows a `sha256=` prefix* — `kit/netlify/functions/booking.mjs` accepts
  both. There's no timestamp, so repeats are recognised by the booking's `uid`.
- **Payload**: `{ triggerEvent, createdAt, payload: { uid, title, startTime, endTime,
  attendees: [{ name, email, timeZone }], responses: { <field>: { label, value } } } }`.
  *Field names beyond these are unconfirmed; test with a real booking.*

## Calendly, for reference

Webhooks on Standard ($10/seat/month yearly) and up, created through the API only
(`POST https://api.calendly.com/webhook_subscriptions`, event `invitee.created`), signed with
`Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. Embeds by
`assets.calendly.com/assets/external/widget.js`. Google, Outlook and Exchange calendars.

## Sources

- https://cal.com/pricing · https://cal.com/faq · https://cal.com/help/webhooks
- https://cal.com/docs/developing/guides/automation/webhooks
- https://cal.com/docs/api-reference/v2/webhooks/create-a-webhook
- https://cal.com/help/embedding/embed-instructions · https://cal.com/help/embedding/prefill-booking-form-embed
- https://cal.com/blog/the-benefits-of-upgrading-to-cal-com-s-team-plan
- https://calendly.com/pricing · https://calendly.com/help/webhooks-overview · https://calendly.com/help/icloud-overview
- https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures
- https://developer.calendly.com/api-docs/69c58da556b61-webhook-payload
