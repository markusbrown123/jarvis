import { useState } from 'react'
import { useHub, hubActions } from '../hub/client'
import type { Site } from '../hub/types'
import { ago, clock, humanize } from '../hub/format'
import { Chip, Empty } from './shared'
import { useTick } from './state'

/**
 * Automaton: the website pipeline at automaton.llc.
 *
 * Stages are the real portfolio_sites statuses, in order. "Deployed" means
 * publish-netlify recorded a published URL; "publicly verified" is JARVIS's
 * own check that the URL answers and shows the business — shown apart. Previews load the site's own hosted preview or published
 * URL in a sandboxed frame. Nothing here publishes, emails or calls anyone.
 */

const STAGES = ['generated_draft', 'needs_review', 'needs_edits', 'approved', 'client_ready', 'deployed']

const CHECK_LABEL = { verified: 'publicly verified', mismatch: 'wrong page', unreachable: 'not answering', 'no-url': 'no URL' } as const
const CHECK_TONE = { verified: 'ok', mismatch: 'need', unreachable: 'fail', 'no-url': 'need' } as const

/** Deployed (what the pipeline recorded) vs publicly verified (what a check of the URL found). */
function CheckChip({ site }: { site: Site }) {
  const c = site.check
  if (!c) return site.publishedUrl ? <Chip tone="idle" title="Checked on the next refresh">not checked yet</Chip> : null
  const title = `${c.reason}${c.status ? ` · HTTP ${c.status}` : ''}${c.ms ? ` · ${c.ms} ms` : ''}${c.checkedAt ? ` · checked ${ago(c.checkedAt)}` : ''}`
  return (
    <Chip tone={CHECK_TONE[c.state]} title={title}>
      {CHECK_LABEL[c.state]}
    </Chip>
  )
}

function SitePreview({ site }: { site: Site }) {
  const mode = useHub((x) => x.prefs.sitePreviewMode)
  const setPrefs = useHub((x) => x.setPrefs)
  const url = site.publishedUrl ?? site.previewUrl
  return (
    <section className="card site-preview">
      <header className="card-head">
        <div>
          <h3>{site.name}</h3>
          <div className="muted">
            {humanize(site.stage)} · updated {ago(site.updatedAt)}
            {site.publishedAt ? ` · published ${clock(site.publishedAt)}` : ''}
            {site.publishStatus === 'error' ? ' · last publish failed' : ''}
          </div>
          {(site.check || site.publishedUrl) && (
            <div className="site-check">
              <CheckChip site={site} />
              {site.check && (
                <span className="muted small">
                  {site.check.reason}
                  {site.check.status ? ` HTTP ${site.check.status}` : ''}
                  {site.check.ms ? ` in ${site.check.ms} ms` : ''}
                  {site.check.checkedAt ? ` · ${ago(site.check.checkedAt)}` : ''}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="tabs">
          <button className={`tab ${mode === 'desktop' ? 'on' : ''}`} onClick={() => setPrefs({ sitePreviewMode: 'desktop' })}>
            Desktop
          </button>
          <button className={`tab ${mode === 'mobile' ? 'on' : ''}`} onClick={() => setPrefs({ sitePreviewMode: 'mobile' })}>
            Mobile
          </button>
          {url && (
            <a className="btn btn-quiet" href={url} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          )}
        </div>
      </header>
      <div className="mode-tag">
        SITE · {site.publishedUrl ? 'PUBLISHED URL' : 'HOSTED PREVIEW'} · {url ?? 'no URL'}
      </div>
      {url ? (
        <div className={`frame-wrap frame-${mode}`}>
          <iframe title={site.name} src={url} sandbox="allow-scripts allow-same-origin allow-popups" loading="lazy" />
        </div>
      ) : (
        <Empty title="No preview URL recorded for this site" />
      )}
      <p className="fine">If the frame stays blank, the site refuses to be embedded — use Open.</p>
    </section>
  )
}

export function Automaton() {
  useTick(15000)
  const s = useHub((x) => x.state)
  const prefs = useHub((x) => x.prefs)
  const setPrefs = useHub((x) => x.setPrefs)
  const [refreshing, setRefreshing] = useState(false)
  const a = s?.projects.automaton
  if (!a) return <Empty title="Checking Automaton…" />
  const sites = a.sites ?? []
  const site = sites.find((x) => x.id === prefs.selectedSite) ?? sites[0]
  const pick = (id: string) => setPrefs({ selectedSite: id })
  return (
    <div className="view view-automaton">
      <header className="view-head">
        <div>
          <h1>Automaton</h1>
          <p className="muted">
            <a href={a.publicUrl} target="_blank" rel="noreferrer">
              automaton.llc
            </a>{' '}
            {a.site ? (a.site.ok ? `answered ${a.site.status} in ${a.site.ms} ms` : `did not answer (${a.site.status || a.site.error})`) : 'not checked'} · {ago(a.site?.checkedAt)}
            {(() => {
              const deployed = sites.filter((x) => x.stage === 'deployed')
              if (!deployed.length) return null
              const ok = deployed.filter((x) => x.check?.state === 'verified').length
              return ` · ${deployed.length} deployed, ${ok} publicly verified`
            })()}
            {a.repo?.commit && (
              <>
                {' '}· repo {a.repo.branch} @ <span className="mono">{a.repo.commit.short}</span>
                {a.repo.changedFiles ? ` · ${a.repo.changedFiles} uncommitted` : ''}
              </>
            )}
          </p>
        </div>
        <div className="detail-actions">
          {a.routes
            .filter((r) => ['/builder', '/editor', '/manager', '/portfolio', '/review'].includes(r.path))
            .map((r) => (
              <a key={r.path} className="btn" href={r.url} target="_blank" rel="noreferrer">
                {r.label} ↗
              </a>
            ))}
          <button
            className="btn"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              await hubActions.refresh('automaton').catch((e) => useHub.getState().say(e.message))
              setRefreshing(false)
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {a.sites === null ? (
        <div className="banner">
          <b>Site pipeline unavailable.</b> {a.sitesError ?? 'No read-only database access yet — JARVIS reads it with the public key from your local Automaton folder.'}
        </div>
      ) : (
        <div className="pipeline">
          {STAGES.map((st) => {
            const here = sites.filter((x) => x.stage === st)
            return (
              <div key={st} className="pipe-col">
                <div className="pipe-head">
                  {humanize(st)} <span className="mono">{here.length}</span>
                </div>
                {here.slice(0, 8).map((x) => (
                  <button key={x.id} className={`pipe-card ${x.id === site?.id ? 'selected' : ''}`} onClick={() => pick(x.id)}>
                    <span className="pipe-name">{x.name}</span>
                    <span className="pipe-sub">
                      {[x.category, x.location].filter(Boolean).join(' · ')} · {ago(x.updatedAt)}
                    </span>
                    {st === 'deployed' && <CheckChip site={x} />}
                  </button>
                ))}
                {here.length > 8 && <div className="muted pipe-more">+{here.length - 8} more</div>}
              </div>
            )
          })}
        </div>
      )}

      <div className="automaton-layout">
        {site ? <SitePreview site={site} /> : <Empty title="No site selected" />}
        <div className="automaton-side">
          <section className="card">
            <header className="card-head">
              <h3>Leads by stage</h3>
            </header>
            {a.leads ? (
              <div className="lead-stages">
                {Object.entries(a.leads.byStage)
                  .sort((x, y) => y[1] - x[1])
                  .map(([k, v]) => (
                    <div key={k} className="lead-row">
                      <span>{humanize(k)}</span>
                      <span className="mono">{v}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted">Unavailable — {a.leadsError ?? 'not readable yet'}</p>
            )}
            <p className="fine">Revenue is not shown: no read-only source for payments is connected.</p>
          </section>
          <section className="card">
            <header className="card-head">
              <h3>AI task board</h3>
              {a.board && <Chip tone="idle">{a.board.active.length} active</Chip>}
            </header>
            {a.board ? (
              <ul className="board">
                {a.board.active.slice(0, 14).map((t) => (
                  <li key={t} className="mono">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Automaton folder not found on this Mac.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
