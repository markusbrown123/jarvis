// node --test bridge/test/ — the autopilot's pace: the day, and the night shift while Markus sleeps.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-autopilot-'))
const { pace } = await import('../hub/autopilot.mjs')

const at = (h) => new Date(2026, 10, 25, h, 30)

test('runs harder at night and keeps the day pace by day', () => {
  const night = pace(at(2), { five_hour: { usedPct: 10 }, seven_day: { usedPct: 40 } })
  assert.equal(night.night, true)
  assert.equal(night.gap, 45 * 60000)
  assert.equal(night.maxAllowance, 85)
  const day = pace(at(14), {})
  assert.equal(day.night, false)
  assert.equal(day.gap, 120 * 60000)
  assert.equal(day.maxAllowance, 70)
  assert.equal(pace(at(5), {}).night, false, 'the night ends at 5, leaving room for the morning')
})

test('a busy week keeps the night at the day pace', () => {
  assert.equal(pace(at(2), { seven_day: { usedPct: 90 } }).night, false)
})
