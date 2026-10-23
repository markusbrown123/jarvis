import { setPlace, SKY, WEATHER } from './sky'

/**
 * The weather where Markus is, so the house's sky matches the one outside
 * his real window: cloud cover, rain or snow, fog, thunderstorms, the wind.
 *
 * Where: the rough location of his public IP address (city level), from
 * ipapi.co with geojs.io as a fallback, remembered for a day. It also puts
 * the sun and the moon where they really are for him (sky.ts). What: the
 * current conditions from Open-Meteo (free, no key, nothing sent but the
 * rounded coordinates), re-read every 15 minutes.
 *
 * Nothing private leaves the Mac beyond what any web request shows (the IP
 * address). If neither service can be reached the sky shows fair weather,
 * and the time zone stands in for the location.
 *
 * The scene eases into changes over a minute or so; things stay wet for a
 * while after rain stops; storms bring the odd flash of lightning.
 */

type Place = { lat: number; lon: number; city: string; at: number }
const KEY = 'jarvis.station.place'
const DAY = 86400000

async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) })
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
}

async function locate(): Promise<Place | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Place | null
    if (saved && Date.now() - saved.at < DAY && Number.isFinite(saved.lat)) return saved
  } catch {
    // unreadable: look again
  }
  const sources: [string, (j: Record<string, unknown>) => Omit<Place, 'at'>][] = [
    ['https://ipapi.co/json/', (j) => ({ lat: Number(j.latitude), lon: Number(j.longitude), city: String(j.city ?? '') })],
    ['https://get.geojs.io/v1/ip/geo.json', (j) => ({ lat: Number(j.latitude), lon: Number(j.longitude), city: String(j.city ?? '') })],
  ]
  for (const [url, pick] of sources) {
    try {
      const p = pick(await getJson(url))
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue
      const place = { ...p, at: Date.now() }
      try {
        localStorage.setItem(KEY, JSON.stringify(place))
      } catch {
        // private window: fine, just not remembered
      }
      return place
    } catch {
      // try the next
    }
  }
  return null
}

/** WMO weather codes to rain, snow and fog (0..1), and a word. */
function fromCode(code: number): { rain: number; snow: number; fog: number; storm: boolean; summary: string } {
  const rain: Record<number, number> = { 51: 0.15, 53: 0.25, 55: 0.35, 56: 0.3, 57: 0.4, 61: 0.4, 63: 0.65, 65: 0.95, 66: 0.45, 67: 0.8, 80: 0.45, 81: 0.7, 82: 1, 95: 0.8, 96: 0.9, 99: 1 }
  const snow: Record<number, number> = { 71: 0.3, 73: 0.6, 75: 0.9, 77: 0.3, 85: 0.5, 86: 0.9 }
  const fog = code === 45 || code === 48 ? 0.8 : 0
  const storm = code >= 95
  const summary = storm ? 'thunderstorm' : snow[code] ? 'snow' : rain[code] ? (code < 60 ? 'drizzle' : code >= 80 ? 'showers' : 'rain') : fog ? 'fog' : code >= 3 ? 'overcast' : code >= 1 ? 'some cloud' : 'clear'
  return { rain: rain[code] ?? 0, snow: snow[code] ?? 0, fog, storm, summary }
}

async function readWeather(p: Place) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}` +
    '&current=cloud_cover,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms'
  const c = (await getJson(url)).current as Record<string, number>
  const w = fromCode(c.weather_code ?? 0)
  // Rain falling that the code doesn't mention still counts, lightly.
  const wetness = (c.rain ?? 0) + (c.showers ?? 0)
  Object.assign(WEATHER, {
    live: true,
    place: p.city,
    cloud: Math.min(1, Math.max(0, (c.cloud_cover ?? 30) / 100)),
    rain: Math.max(w.rain, wetness > 0.05 ? Math.min(0.6, 0.15 + wetness * 0.2) : 0),
    snow: Math.max(w.snow, (c.snowfall ?? 0) > 0.02 ? 0.3 : 0),
    fog: w.fog,
    storm: w.storm,
    wind: c.wind_speed_10m ?? 4,
    windFrom: c.wind_direction_10m ?? 270,
    summary: w.summary,
  })
}

/** Start reading the weather; returns a stop function. */
export function startWeather(onChange: () => void) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    const p = await locate()
    if (stopped) return
    if (p) {
      setPlace(p.lat, p.lon)
      try {
        await readWeather(p)
      } catch {
        WEATHER.live = false
      }
    }
    if (!stopped) {
      onChange()
      timer = setTimeout(run, 15 * 60 * 1000)
    }
  }
  void run()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

/** Development: try some weather, e.g. tryWeather({ rain: 0.8, cloud: 1, storm: true }). */
export function tryWeather(w: Partial<typeof WEATHER>) {
  Object.assign(WEATHER, w)
}

let flashAt = 0
let nextFlash = 0
/** Ease the shaders towards the weather, once a frame. */
export function easeWeather(dt: number, t: number) {
  const k = Math.min(1, dt * 0.05)
  SKY.uCloud.value += (WEATHER.cloud - SKY.uCloud.value) * k
  SKY.uRain.value += (WEATHER.rain - SKY.uRain.value) * Math.min(1, dt * 0.08)
  SKY.uSnow.value += (WEATHER.snow - SKY.uSnow.value) * Math.min(1, dt * 0.08)
  SKY.uFog.value += (Math.max(WEATHER.fog, WEATHER.rain * 0.5) - SKY.uFog.value) * k
  // Wet within a minute of rain; dry over ten after.
  const wet = SKY.uRain.value > 0.05 ? 1 : 0
  SKY.uWet.value += (wet - SKY.uWet.value) * Math.min(1, dt * (wet ? 1 / 60 : 1 / 600))
  // The wind blows from windFrom (compass); scene +X north, +Z east.
  const a = (WEATHER.windFrom * Math.PI) / 180
  SKY.uWind.value.set(-Math.cos(a) * WEATHER.wind, -Math.sin(a) * WEATHER.wind)
  // Lightning, now and then in a storm: a double flicker.
  if (WEATHER.storm && t > nextFlash) {
    flashAt = t
    nextFlash = t + 6 + Math.random() * 18
  }
  const f = t - flashAt
  SKY.uFlash.value = WEATHER.storm && f < 0.6 ? Math.max(0, 1 - f / 0.12) + (f > 0.2 ? Math.max(0, 0.7 - (f - 0.2) / 0.3) : 0) : 0
}
