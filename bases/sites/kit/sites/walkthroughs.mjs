/**
 * The real estate walkthrough service's page for agents.
 *
 * "Listing Walkthroughs" is a working name until Markus picks one. The price
 * is set after the test listings (bases/realestate/BRIEF.md), so it's never
 * quoted here; the assistant offers a call instead. The booking link comes
 * from BOOKING_URL_WALKTHROUGHS.
 */
export default {
  id: 'walkthroughs',
  name: 'Listing Walkthroughs',
  origins: ['https://automaton.llc', 'https://www.automaton.llc'],
  accent: '#c8ff00',
  greeting: "Hi — ask me how a listing's photos become a video walkthrough, what you'd send, or how quickly it comes back.",
  suggestions: ['What do I need to send?', 'How long does it take?', 'Is anything AI-generated?'],
  booking: { label: 'Book a 15-minute demo' },
  contact: { phone: '(862) 325-3923', email: 'support@automaton.llc' },
  thanks: "Thanks — we'll be in touch within one business day.",
  facts: `Listing Walkthroughs turns a listing's photos into a smooth video walkthrough for real estate agents — for the listing page, YouTube, Instagram and TikTok.

WHAT THE AGENT GETS
- A walkthrough video built from the listing photos: one slow, steady camera move per photo (push in, pan, pull back), in a room-by-room order, with room captions.
- Two cuts: 16:9 for the listing and YouTube, 9:16 for Reels, TikTok and Stories, plus a thumbnail.
- The agent sees it and approves it before it's used anywhere.

WHAT THE AGENT SENDS
- 10 to 25 listing photos they have the right to use, in the order they'd like (front of the house first is usual).
- The address and the listing's facts (beds, baths, size, features), and their logo or brand colours if they want them on it.

HOW IT'S MADE, HONESTLY
- The property is shown exactly as it is: the camera moves, the rooms don't change. Nothing is added, removed, restyled or hidden.
- Some shots use AI image-to-video models to create the camera movement. Anything AI-made is said to be, to the agent and wherever the platform or MLS requires it.
- Facts come only from the agent and the listing; nothing is invented.

TIMING AND PRICE
- The aim is a finished walkthrough within one business day of receiving the photos.
- Pricing is per listing, with a monthly option for busy agents; it's set on a short call. No price is quoted in chat.

Contact: call (862) 325-3923 or email support@automaton.llc.`,
}
