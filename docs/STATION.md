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
| **Command** mode | Panels, zone labels, tooltips, detail panel. For working. |
| **Cinematic** mode (`C`) | Panels away; camera pulls back and drifts round the station; names only on the zones; a caption strip with every system's live state and each event as it lands. Same data, so it never becomes a screensaver. |
| Camera presets | Overview, Roblox, Automaton, Finance, Jobs, Needs Markus, Jarvis Core. Smooth flights; grabbing the view mid-flight hands control back. |
| Reset (`R`) | Clears the selection and flies back to the overview. |
| Connections (`L`) | Brightens every link and labels it with its state and what it carries. |
| Click | Anything in the room, a zone label, a job or a Needs item in the panels: selects it, flies to its zone, opens the detail panel and narrows the terminal to lines about it. Click empty space to deselect. |
| Hover | A tooltip with the thing's status and its source. |
| Quality | Low / High / Ultra on the top bar (or Settings). A blank-frame guard steps down automatically if a setting renders nothing on this machine. |
| Reduced motion | Settings → reduced motion: flows stop, flights jump, rotations slow to a crawl. |

## The room

| Element | Source | Changes when | Means | Click / hover | When unavailable |
|---|---|---|---|---|---|
| **Floor and deck light** (hex seams, circuit traces, scan) | Static pattern, plus each zone's state | A zone's state or events change | Pools of light round each zone: brighter when active, steady when it needs you, a red-orange pulse when it's in error; a ripple from the zone when an event lands there; a red flash when something fails there | — | The zone's pool goes dark |
| **Reactor** colour and motion | JARVIS's voice phase (`useStore.phase`, `level`) | Every frame | Standby: slow blue-violet. Listening: orange, breathing with the mic. Thinking / working: violet, rings speed up, conduits flow inward. Speaking: cyan, pulsing with his actual output level | — | Offline: dim grey |
| Reactor amber halo | Open Needs Markus items, jobs waiting on Markus | Hub update | Something needs your input | — | — |
| Reactor completion wave | `complete` events | A job finishes | A ring of light leaves the core | — | — |
| Reactor red segment | Voice error or bridge down | Error appears/clears | Localised on the base ring only, so the rest stays readable | — | — |
| **Robot arms** (front left serves Needs, Core, Roblox; front right serves Automaton, Finance, Jobs) | Events and zone states | A transfer event, a zone going active, JARVIS thinking | Swing over to the zone that just sent or received work and light their stripe in its colour; tend the busiest active zone; work at the reactor while he thinks; dock folded when nothing is happening | — | Docked |
| Rack lights (back wall) | Terminal lines in the last minute | Every 0.1 s | Blink faster the more is happening | — | — |
| Back screen | Latest studio ASSET render | New render | The newest picture from the Roblox studio | — | Hidden when there is none |

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
| **Jarvis Core** | Bridge link, `/health` (model, write mode, voice), mic, phone pairing, status-line allowance reading | An orb in the reactor's current colour; one pylon per capability, ring colour = ok / warn / off / error | Capability: its detail, e.g. "3% of 5h left", "not paired" | Allowance shows "unavailable — no fresh status-line reading" rather than a number |

## Connections

| Link | Style → meaning |
|---|---|
| Reactor → each zone (pathway across the deck) | **active**: bright dashes flowing out to the zone · **queued**: slow dim pulses · **idle**: faint line · **attention**: amber, flowing back towards the reactor · **disconnected**: grey, broken in the middle, no flow · **failed**: red, broken, flickering · turns **green** for a moment when a job there completes |
| Jobs → project (arc) | Jobs running for that project |
| Needs → project (arc) | Items waiting on you for that project |
| Packets | One per live event: work assigned goes out from the reactor; results, leads, studio moves and voice come in; a new item comes in from its project and goes back out to Needs Markus |

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
| `floor.tsx` | Procedural hex floor and island deck, zone light |
| `reactor.tsx` | The reactor |
| `clusters.tsx` | The six zone structures |
| `links.tsx` | Pathways, arcs, packets |
| `parts.tsx` | Arms, racks, room, back screen |
| `camera.tsx` | Orbit controls, flights, cinematic drift |
| `labels.tsx` | Zone/link labels with collision avoidance, tooltip |
| `describe.ts` | Words for any selected thing, and which terminal lines are about it |
| `Detail.tsx`, `Station.tsx` | Detail panel; HUD, toolbar, modes |
