# JARVIS Station — what everything means

The Station (dashboard key `0`) is a 3D control room built only from live
state. Nothing in it is decorative-random: every light, colour and moving
part is driven by something real, and when that something can't be read the
scene says so instead of filling in.

All of it comes from one mapping, `src/station/model.ts` (`buildModel`), so
the scene, the labels, the tooltips and the panels can't disagree. Recent
changes become one-shot events in `src/station/events.ts`, always by
comparing one hub snapshot with the next — never from a timer.

## Modes and controls

| Control | What it does |
|---|---|
| **Walk** mode (`F`) | On foot, first person. `W A S D` / arrows to move, `Shift` to run, the mouse to look (click the room to capture it, `Esc` lets go — or just drag). You can't walk through the console, pads, build bay or walls; the open glass panel straight ahead leads out onto the terrace, round the pool to the balustrade. `E` sits you at the console when you're facing it, or opens the zone you're facing. Talking works as usual. While walking, W A S D and E are taken for walking before the app's own shortcuts (D diagnostics, E panels). |
| **Talk** mode (`J`, the default) | Sat at the centre console, camera just behind the chair, looking out over the desk and its monitors to the room — with a gentle depth of field on High and Ultra: the full conversation on the left with a line to type to him, his current state (and the tool he's using), and what's waiting on you, if anything. The room stays quiet: names only, no panels. |
| **Command** mode | Panels, zone labels, tooltips, detail panel. For working. |
| **Cinematic** mode (`C`) | Panels away; camera pulls back and drifts round the station; names only on the zones; a caption strip with every system's live state and each event as it lands. Same data, so it never becomes a screensaver. |
| Camera presets | Overview, Roblox, Automaton, Finance, Jobs, Needs Markus, Jarvis Core. Smooth flights; grabbing the view mid-flight hands control back. |
| Reset (`R`) | Clears the selection and flies back to the overview. |
| Connections (`L`) | Brightens every link and labels it with its state and what it carries. |
| Click | (In Talk or Cinematic, clicking something switches to Command.) Anything in the room, a zone label, a job or a Needs item in the panels: selects it, flies to its zone, opens the detail panel and narrows the terminal to lines about it. Click empty space to deselect. |
| Hover | A tooltip with the thing's status and its source. |
| Quality | Low / High / Ultra on the top bar (or Settings). A blank-frame guard steps down automatically if a setting renders nothing on this machine. |
| Reduced motion | Settings → reduced motion: flows stop, flights jump, rotations slow to a crawl. |

## The room

| Element | Source | Changes when | Means | Click / hover | When unavailable |
|---|---|---|---|---|---|
| **The house** (travertine floors, black marble stage, concrete walls, white ceiling with a coffer, a 180° curved glass wall in black frames; outside a terrace with an infinity pool and glass balustrade under a cantilevered roof, limestone cliffs, gardens) | Modelled and lit in Blender (`tools/blender/lair.py`): a 4K detail map per surface (travertine pores and veins, marble veins, hairline cracks, board-formed concrete) and a Cycles lightmap that keeps three kinds of light apart — the house's warm lights, JARVIS's light, the sky's light through the glass | Time of day, weather, JARVIS's state | The sky's light is coloured live by the real sky; JARVIS's by his state; the warm lights carry the house at night. The floor and stage mirror the room live on High and Ultra. In Command the roof and the near wall are cut away | — | If its files are missing the rest of the station still draws and JARVIS says why |
| **The sky** | The clock and where you are (`sky.ts`): the sun's and moon's real positions, the moon's real phase, the stars turned to sidereal time; the colour from scattering in the atmosphere | Every few seconds | Day, golden hour, sunset, twilight, night as they really are for you. The glass faces west, so sunsets are in view. Sunlight (or moonlight) comes in through the glass in panes striped by the frames, only when the sun is low enough to get under the roof | — | Location falls back to the time zone |
| **The weather** | Where you are from your IP address (ipapi.co, geojs.io fallback, remembered a day) and the current conditions from Open-Meteo, every 15 min (`weather.ts`) | Every 15 min, eased in over a minute | Cloud cover from fair to overcast; rain or snow falling past the glass and onto the terrace (none under the roof), drops on the glass, rings on the pool, a choppier sea and a wet, glossy terrace for a while after; fog; lightning in thunderstorms | — | Fair weather with a few clouds |
| **Outside** (sea, boats, coast) | Drawn in shaders (`outside.tsx`, `boats.tsx`) | Every frame | Per-pixel waves, rougher in wind, with whitecaps, ripples up close and drifting cloud shadows; the sun's or moon's glitter path; surf at the foot of the cliffs. A yacht, two sailboats, a speedboat, two jet skis and a container ship on long loops, wakes drawn in the water, navigation lights after dark. Coast towns light up at dusk | — | — |
| Coffer halo over the console, line of light round the stage, and their light on the room | JARVIS's state | Every frame | His colour, brightening with his voice | — | — |
| **Zone light on the stage** | Each zone's state and events | A zone's state or events change | Pools of light round each zone: brighter when active, steady when it needs you, a red-orange pulse when it's in error; a ripple from the zone when an event lands there; a red flash when something fails there | — | The zone's pool goes dark |
| **Centre console** (platform, command desk, chair) | Modelled in Blender, surfaces baked with Cycles (`tools/blender/console.py`) | — | Brushed steel, seamed panels, vented plinth and plated platform with ray-traced ambient occlusion; 4096 px textures on Ultra, 2048 on High, 1024 on Low | Walk up and press `E` to sit | — |
| Console light strips (platform ring, back step, desk edges, monitor shelf, end panels, chair back) | JARVIS's voice phase (`useStore.phase`, `level`) | Every frame | His colour: standby blue, listening orange, thinking / working violet, speaking cyan — brightening with his voice; a light over the desk takes the same colour | — | Offline: dim |
| Desk holo pads | Open Needs Markus items, jobs waiting on Markus | Hub update | Amber and pulsing while something needs your input; his colour otherwise | — | — |
| Platform completion wave | `complete` events | A job finishes | A ring of light leaves the platform | — | — |
| Platform red segment | Voice error or bridge down | Error appears/clears | Localised on the platform ring only, so the rest stays readable | — | — |
| **Build bay** (holo-table straight back from the console) | Job feed (`state.jobs`): running, waiting on you, failed and done (last hour), queued — up to nine | Hub update | One tower per job in its project's colour. Running: one floor per step the job reports (`done` of `total`), the rest scaffolding, a laser sweeping the floor being printed; a job that doesn't report steps shows only scaffolding with the laser hunting up and down — never an invented figure. Waiting on you: paused, amber beacon. Queued: an empty plot. Done: the finished tower, lit. Failed: red, its top fallen in. A new floor flashes as it lands; a finished job sends a ring across the table. The crane swings to the job being built. The table's front reads the counts and that job's step | Click a tower: its job card | Nothing on the table; "Nothing being built right now" |
| Holo keyboard | Typing in the Talk box | Each keystroke | Lights up while you type to JARVIS, fades after a second | — | — |
| Desk monitor: **Systems** | Voice phase, `caps` (bridge, brain, voice, mic, phone, allowance) | State change | What JARVIS is doing, and each of his systems with its real detail | — | Each row says unavailable / not set up |
| Desk monitor: **Zones** | Each zone's state and headline | Hub update | All six systems at a glance | — | "reading…" |
| Desk monitor: **Work** | Jobs and open items | Hub update | Running / queued counts, the first four jobs (stale ones flagged), how many wait on you and the first | — | "Connecting…" |
| Desk monitor: **Business** | Site probe, pipeline, leads, finance services, expense ledger, allowance | Hub update | One row each, only with real figures — "unavailable — reason" otherwise; "No broker connected — no positions or P&L" | — | As stated per row |

## Zones

Each zone sits on a pad; the pad's rim colour and pulse are the zone's state:
loading (dim), idle (steady), active (pulsing), needs you (fast pulse), error
(red), unavailable (dark). Its label shows the name, the state, one headline,
and the data's freshness when it isn't live.

| Zone | Source | 3D structure | Click / detail actions | When unavailable |
|---|---|---|---|---|
| **Roblox** | Studio queue (`projects.roblox`, read from the studio repo) | Hub with a rotating wire cube (speed = how busy); one cube per game (14): bright while building, amber when blocked, ring = active game, cyan dot = published | Game: tasks running/queued/blocked, flags, last playtest. Zone: Refresh now, open Roblox page | "Studio unreachable" with the error; cubes absent |
| **Automaton** | Site probe of automaton.llc; site pipeline; leads | Wire globe (cyan = site up with ping, red pulsing = not answering, grey = unchecked); six stage pillars, height = sites at that stage; one dot per lead (aggregated, max 36) | Stage: count and site names. Zone: Refresh now, open Automaton page | Pillars drawn as grey wireframe ghosts with the reason ("Pipeline unavailable — …"); no lead dots, reason shown |
| **Finance** | Local service checks; Quant View config | Curved terminal listing each service and its state, the Quant View name, and "No broker connected — no positions, balances or P&L"; one pylon per service (green light = running) | Service: status and latency. Zone: Refresh now, open Finance page | Monitoring only — never shows invented prices, positions or P&L |
| **Jobs** | Job feed (`state.jobs`) | A rail: queued capsules stacked on the left, running (and waiting-on-you) along the middle, done and failed (last hour) on the right. Stale ones (no heartbeat) turn orange | Job: the dashboard's own job card with real Cancel when the worker supports it | Feed offline shown on the label; no invented progress |
| **Needs Markus** | Open items (`state.items`) | One amber beacon per item, height and pulse by priority (P1 tallest, fastest) | Item: the dashboard's own item card — its real checks, "I'm on it", Snooze 4h | "Nothing needs you" — a dim ring |
| **Jarvis Core** | Bridge link, `/health` (model, write mode, voice), mic, phone pairing, status-line allowance reading | An orb in JARVIS's current colour; one pylon per capability, ring colour = ok / warn / off / error | Capability: its detail, e.g. "3% of 5h left", "not paired" | Allowance shows "unavailable — no fresh status-line reading" rather than a number |

## Connections

| Link | Style → meaning |
|---|---|
| Console → each zone (pathway across the deck) | **active**: bright dashes flowing out to the zone · **queued**: slow dim pulses · **idle**: faint line · **attention**: amber, flowing back towards the console · **disconnected**: grey, broken in the middle, no flow · **failed**: red, broken, flickering · turns **green** for a moment when a job there completes |
| Jobs → project (arc) | Jobs running for that project |
| Needs → project (arc) | Items waiting on you for that project |
| Packets | One per live event: work assigned goes out from the console; results, leads, studio moves and voice come in; a new item comes in from its project and goes back out to Needs Markus |

Arcs stay faint unless Connections View is on or one of their ends is
selected or hovered.

## Panels (Command mode)

| Panel | Notes |
|---|---|
| Business & money | Each figure carries its source and age (site probe, pipeline, leads table, expense ledger, status line, this bridge's requests). Green dot = fresh, amber = stale (over 20 min), grey = unavailable. Trading is labelled monitoring-only. |
| Terminal | Filters: All, Voice, Jobs, Code, Phone, Studio, **Errors**. With a selection open it shows only lines about it ("show all" to undo). |
| Detail | Opens on selection: what it is, where its data comes from, and only real actions. |
| Needs Markus / Running | Click a row to select it in the room. |

## Files

| File | Role |
|---|---|
| `model.ts` | Live state → scene mapping (zones, nodes, links, freshness) |
| `events.ts` | Snapshot diffs → one-shot events |
| `stationStore.ts` | Selection, hover, mode, camera view, Connections View, events |
| `layout.ts` | Where everything is; camera presets; pathway geometry |
| `lair.tsx` | The house: Blender model, detail maps and baked lightmaps, live mirror floor, glass, pool |
| `houselight.ts` | Sun and moon through the glass only (the house's shape in the shaders); the lightmaps' three kinds of light |
| `sky.ts` | Sun, moon and stars from the clock; atmospheric scattering; the sky's shaders; weather state |
| `weather.ts` | Location from IP, current weather from Open-Meteo, easing, lightning |
| `outside.tsx` | Sky backdrop, sea, surf, wakes, coast |
| `boats.tsx`, `wakes.ts` | The boats and jet skis, and what the sea needs to draw their wakes |
| `rain.tsx` | Rain and snow |
| `environment.tsx` | Reflections and ambient light: the room and the sky, re-rendered as the sky moves |
| `foundry.tsx` | The build bay |
| `holo.ts` | Shared hologram look, hover and click |
| `floor.tsx` | Zone light on the stage; contact shadows |
| `console.tsx` | The centre console: Blender model and baked textures, live lights, the four monitors |
| `clusters.tsx` | The six zone structures |
| `links.tsx` | Pathways, arcs, packets |
| `camera.tsx` | Orbit controls, flights, cinematic drift |
| `walk.tsx` | Walk mode: first-person movement, collisions, E to use |
| `labels.tsx` | Zone/link labels with collision avoidance (never over the console), tooltip |
| `describe.ts` | Words for any selected thing, and which terminal lines are about it |
| `Detail.tsx`, `Station.tsx` | Detail panel; HUD, toolbar, modes, Talk panel |
