# Real estate AI video walkthroughs

## What
Turn a listing's photos (and floor plan) into a smooth video walkthrough with a voiceover, for real estate agents: a clip they can put on the listing, on Instagram and on YouTube. Sold per listing, or monthly to a busy agent.

## Goal
One paying agent. Before that: three test listings, and a delivery time of under a day per listing. Price is set after the tests, once the real cost per listing is known.

## How it works
1. **Intake**: photos, address, the listing's own facts (beds, baths, size, features), the agent's branding.
2. **Shot plan**: the order of rooms, and a camera move for each photo.
3. **Motion**: each photo becomes a few seconds of camera movement — an image-to-video model, tried on the same photos side by side first (cost per clip, realism, whether rooms stay the same room).
4. **Edit**: stitch, colour, captions, the agent's branding, music (licensed or generated only) — `ffmpeg`.
5. **Voiceover**: a script from the verified facts only; ElevenLabs, whose key stays in the Keychain.
6. **Deliver**: 16:9 and 9:16 cuts and a thumbnail, to the agent for approval. Nothing is posted before they've approved it.

## First milestones
- [ ] 10 photos of one property → a 30-second clip, from two or three models, compared
- [ ] `walkthrough` script: a folder of photos in, an MP4 out
- [ ] A sample reel for outreach, from photos Markus has the right to use
- [ ] A list of 20 local agents (Markus does the contacting)
- [ ] Price and terms

## Rules
- Facts come from the listing and the agent. No invented sizes, features, views or neighbourhood claims.
- The property is shown as it is: no added rooms, no hidden defects. Anything virtually staged or AI-made is said to be, to the agent and wherever the platform or MLS requires it.
- Client photos and details stay out of git (a client folder outside the repo).
- Nothing is sent to an agent or posted without Markus.

## Status
Not started: base only.
