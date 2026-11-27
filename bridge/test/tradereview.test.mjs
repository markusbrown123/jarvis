// node --test bridge/test/ — the daily trading review: what it may and may not change.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), 'jarvis-review-'))
const paper = await import('../hub/papertrade.mjs')
const review = await import('../hub/tradereview.mjs')

test('the brief carries the scoreboard, the trades and the rules', () => {
  const b = review.brief()
  assert.match(b, /pretend money only/)
  assert.match(b, /meme-steady/)
  assert.match(b, /ADD: \{"id"/)
  assert.match(b, /Never a random control/)
})

test('ADD and STOP lines are applied within the limits', () => {
  paper._reset()
  const s = paper.state()
  const loser = s.strategies['meme-momentum']
  loser.closed = Array.from({ length: 20 }, () => ({ pnlUsd: -1, fees: 0.4 }))
  s.strategies['meme-dip'].closed = Array.from({ length: 3 }, () => ({ pnlUsd: -1, fees: 0.4 }))

  const output = `Momentum is losing to random; the Pulse shows migrated launches with 100+ buyers holding up.

ADD: {"id": "pulse-busy-migrated", "market": "pulse", "kind": "filter", "params": {"stage": "migrated", "minBuyers": 100, "lev": "ignored", "evil": {"x": 1}}, "note": "100+ buyers at discovery held up best over 6h"}
ADD: {"id": "perp-slow-trend", "market": "perp", "kind": "trend", "params": {"fast": 30, "slow": 90, "lev": 50}}
ADD: {"id": "third-idea", "market": "meme", "kind": "filter", "params": {}}
ADD: {not json}
STOP: meme-momentum :: 20 trades, -50%, well behind random
STOP: meme-random :: it is random
STOP: meme-dip :: looks bad
STOP: no-such-strategy :: whatever
LESSON: something`
  const changes = review.apply(output)
  const text = changes.join('\n')

  assert.equal(s.strategies['meme-momentum'].active, false)
  assert.match(s.strategies['meme-momentum'].retiredWhy, /daily review/)
  assert.equal(s.strategies['meme-random'].active, true, 'the control is never stopped')
  assert.equal(s.strategies['meme-dip'].active, true, 'three trades is too few to judge')
  assert.match(text, /kept meme-dip: only 3 trades/)

  const busy = s.strategies['pulse-busy-migrated']
  assert.ok(busy?.active)
  assert.equal(busy.params.minBuyers, 100)
  assert.equal(busy.params.evil, undefined, 'only numbers and strings get through')
  assert.equal(s.strategies['perp-slow-trend'].params.lev, 5, 'leverage stays within bounds')
  assert.equal(s.strategies['third-idea'], undefined, 'at most two new strategies a day')
})

test('a market at its limit takes no more', () => {
  paper._reset()
  const s = paper.state()
  for (let i = 0; i < 8; i++) paper.addStrategy({ id: `pulse-x${i}`, market: 'pulse', kind: 'filter' })
  const changes = review.apply('ADD: {"id": "one-more", "market": "pulse", "kind": "filter", "params": {}}')
  assert.equal(s.strategies['one-more'], undefined)
  assert.match(changes.join('\n'), /already has \d+ strategies running/)
})

test('it waits until there is something to review', () => {
  paper._reset({ wipe: true })
  const started = []
  const r = review.run({ runner: { start: (job) => (started.push(job), { id: 'j1' }) } })
  assert.equal(r.started, false)
  assert.equal(started.length, 0)
})
