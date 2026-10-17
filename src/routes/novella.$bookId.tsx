import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Download, Pause, Play, RotateCcw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { Brief, NovellaView, RunStatus, Settings } from '#/lib/novella.server'
import { type ExportDoc, buildEpub, buildMarkdown, buildPdf, buildText, validateDoc } from '#/lib/novella-export'
import { getBookFn, getDefaultSettingsFn, getGroqStatusFn, getNovellaFn, pauseRunFn, resetRunFn, saveBriefFn, startRunFn } from '#/lib/novella.fns'

export const Route = createFileRoute('/novella/$bookId')({
  loader: async ({ params }) => {
    const [novella, defaults, groq, book] = await Promise.all([
      getNovellaFn({ data: params.bookId }),
      getDefaultSettingsFn(),
      getGroqStatusFn(),
      getBookFn({ data: params.bookId }),
    ])
    return { novella, defaults, hasKey: groq.hasKey, book }
  },
  component: NovellaDashboard,
})

const STATUS_STYLES: Record<RunStatus, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-sky-500/10 text-sky-500',
  paused: 'bg-amber-500/10 text-amber-500',
  completed: 'bg-emerald-500/10 text-emerald-500',
  failed: 'bg-destructive/10 text-destructive',
  budget_exhausted: 'bg-destructive/10 text-destructive',
}

const BRIEF_FIELDS: Array<[keyof Brief & string, string]> = [
  ['title', 'Title'],
  ['genre', 'Genre'],
  ['tone', 'Tone'],
  ['pov', 'POV'],
  ['tense', 'Tense'],
  ['premise', 'Premise'],
  ['characters', 'Characters'],
  ['setting', 'Setting'],
  ['ending', 'Ending'],
  ['plotPoints', 'Must-have plot points'],
]

const MULTILINE = new Set<keyof Brief>(['premise', 'characters', 'setting', 'ending', 'plotPoints'])

const NUMBER_FIELDS: Array<[keyof Settings & string, string, number]> = [
  ['totalUsd', 'Total budget (USD)', 2],
  ['draftingUsd', 'Drafting budget (USD)', 1.3],
  ['reserveUsd', 'Reserve (USD)', 0.7],
  ['chapterCount', 'Chapters', 12],
  ['targetWords', 'Target words', 15000],
  ['reviseRounds', 'Revise rounds (0 or 1)', 0],
  ['maxConcurrent', 'Max concurrent', 4],
  ['perModelConcurrency', 'Concurrency per model', 2],
  ['retryMax', 'Retry max', 3],
]

const MODEL_FIELDS: Array<[keyof Settings & string, string]> = [
  ['planner', 'Planner model'],
  ['writer', 'Writer model'],
  ['auditor', 'Auditor model'],
  ['editor', 'Editor model'],
  ['fallbackModel', 'Fallback model (optional)'],
]

const money = (n: number) => `$${n.toFixed(4)}`
const inputClass = 'w-full bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50'

function NovellaDashboard() {
  const { novella, defaults, hasKey, book } = Route.useLoaderData()
  const [view, setView] = useState<NovellaView | null>(novella)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const running = view?.status === 'running'

  // Poll while a run is active.
  useEffect(() => {
    if (!running || !book) return
    const id = window.setInterval(() => {
      getNovellaFn({ data: book.id }).then(setView).catch((e: Error) => setError(e.message))
    }, 2000)
    return () => window.clearInterval(id)
  }, [running, book])

  async function act(fn: () => Promise<NovellaView>) {
    setBusy(true)
    setError(null)
    try {
      setView(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!book) {
    return (
      <main className="max-w-xl mx-auto py-24 text-center">
        <h1 className="text-2xl font-bold font-display mb-4">Book not found.</h1>
        <Link className="text-primary hover:underline text-sm font-medium" to="/">Return to your library</Link>
      </main>
    )
  }

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-6 flex flex-col gap-8">
      <div className="flex justify-between items-center flex-wrap gap-3 pb-4 border-b border-border">
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" params={{ bookId: book.id }} to="/books/$bookId">
          <ArrowLeft size={16} /> Back to book
        </Link>
        <h1 className="text-2xl font-bold font-display">Novella engine</h1>
      </div>

      {error && <div className="rounded-xl bg-destructive/10 text-destructive text-sm p-3" role="alert">{error}</div>}

      <BriefForm
        bookId={book.id}
        bookTitle={book.title}
        busy={busy || running}
        defaults={defaults}
        initial={view}
        onSaved={(v) => setView(v)}
        onError={setError}
      />

      {view ? (
        <RunPanel busy={busy} hasKey={hasKey} onAction={act} view={view} />
      ) : (
        <p className="text-sm text-muted-foreground">Save a brief to create the novella project.</p>
      )}

      {view && <ManuscriptPanel bookAuthor={book.author} bookTitle={book.title} view={view} />}
    </main>
  )
}

function BriefForm({ bookId, bookTitle, busy, defaults, initial, onSaved, onError }: {
  bookId: string
  bookTitle: string
  busy: boolean
  defaults: Settings
  initial: NovellaView | null
  onSaved: (view: NovellaView) => void
  onError: (msg: string | null) => void
}) {
  const [brief, setBrief] = useState<Brief>(() => initial?.brief ?? emptyBrief(bookTitle))
  const [settings, setSettings] = useState<Settings>(() => initial?.settings ?? defaults)
  const [saving, setSaving] = useState(false)

  const models = [...new Set([settings.planner, settings.writer, settings.auditor, settings.editor, settings.fallbackModel].filter(Boolean) as string[])]

  function setPrice(model: string, side: 'input' | 'output', value: string) {
    const current = settings.pricing[model] ?? { input: 0, output: 0 }
    setSettings({ ...settings, pricing: { ...settings.pricing, [model]: { ...current, [side]: Number(value) } } })
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    onError(null)
    try {
      onSaved(await saveBriefFn({ data: { bookId, brief, settings } }))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const disabled = busy || saving
  const section = 'bg-card p-6 rounded-2xl border border-border flex flex-col gap-4'

  return (
    <form className="grid grid-cols-1 lg:grid-cols-2 gap-6" onSubmit={save}>
      <section className={section}>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">A. Brief</h2>
        {BRIEF_FIELDS.map(([key, label]) => (
          <label className="block text-xs font-medium" key={key}>
            {label}
            {MULTILINE.has(key) ? (
              <textarea className={`${inputClass} mt-1 h-20 font-normal`} disabled={disabled} onChange={(e) => setBrief({ ...brief, [key]: e.target.value })} value={brief[key]} />
            ) : (
              <input className={`${inputClass} mt-1 font-normal`} disabled={disabled} onChange={(e) => setBrief({ ...brief, [key]: e.target.value })} value={brief[key]} />
            )}
          </label>
        ))}
      </section>

      <section className={section}>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MODEL_FIELDS.map(([key, label]) => (
            <label className="block text-xs font-medium" key={key}>
              {label}
              <input className={`${inputClass} mt-1 font-normal`} disabled={disabled} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} value={(settings[key] as string | undefined) ?? ''} />
            </label>
          ))}
          {NUMBER_FIELDS.map(([key, label]) => (
            <label className="block text-xs font-medium" key={key}>
              {label}
              <input className={`${inputClass} mt-1 font-normal`} disabled={disabled} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} step="any" type="number" value={settings[key] as number} />
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Pricing per million tokens (USD)</p>
          {models.map((model) => (
            <div className="grid grid-cols-[1fr_6rem_6rem] gap-2 items-center text-xs" key={model}>
              <span className="truncate font-mono">{model}</span>
              <input aria-label={`${model} input price`} className={inputClass} disabled={disabled} min="0" onChange={(e) => setPrice(model, 'input', e.target.value)} step="any" type="number" value={settings.pricing[model]?.input ?? 0} />
              <input aria-label={`${model} output price`} className={inputClass} disabled={disabled} min="0" onChange={(e) => setPrice(model, 'output', e.target.value)} step="any" type="number" value={settings.pricing[model]?.output ?? 0} />
            </div>
          ))}
        </div>

        <button className="self-start px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50" disabled={disabled} type="submit">
          <Save size={16} /> {saving ? 'Saving...' : 'Save brief & settings'}
        </button>
      </section>
    </form>
  )
}

function RunPanel({ busy, hasKey, onAction, view }: {
  busy: boolean
  hasKey: boolean
  onAction: (fn: () => Promise<NovellaView>) => Promise<void>
  view: NovellaView
}) {
  const { budget, usage, progress, tasks, logs } = view
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [logs.length])

  const used = budget.spent + budget.reserved
  const pct = budget.total > 0 ? Math.min(100, (used / budget.total) * 100) : 0
  const cards: Array<[string, number]> = [
    ['Spent', budget.spent],
    ['Reserved', budget.reserved],
    ['Uncertain', budget.uncertain],
    ['Drafting remaining', budget.draftingRemaining],
    ['Reserve remaining', budget.reserveRemaining],
    ['Total remaining', budget.totalRemaining],
  ]

  return (
    <section className="flex flex-col gap-6 bg-card p-6 rounded-2xl border border-border">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <span className={`text-xs px-3 py-1 rounded-full font-medium uppercase ${STATUS_STYLES[view.status]}`}>{view.status.replace('_', ' ')}</span>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 disabled:opacity-50" disabled={busy || view.status === 'running' || !hasKey} onClick={() => void onAction(() => startRunFn({ data: view.bookId }))} type="button">
              <Play size={16} /> Start
            </button>
            <button className="px-4 py-2 rounded-xl border border-border text-sm font-medium flex items-center gap-1.5 disabled:opacity-50" disabled={busy || view.status !== 'running'} onClick={() => void onAction(() => pauseRunFn({ data: view.bookId }))} type="button">
              <Pause size={16} /> Pause
            </button>
            <button className="px-4 py-2 rounded-xl bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-1.5 disabled:opacity-50" disabled={busy || view.status === 'running'} onClick={() => void onAction(() => resetRunFn({ data: view.bookId }))} type="button">
              <RotateCcw size={16} /> Reset
            </button>
          </div>
          {!hasKey && <p className="text-xs text-destructive">GROQ_API_KEY is not set on the server</p>}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Spent + reserved</span>
          <span>{money(used)} / {money(budget.total)}</span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(([label, value]) => (
          <div className="rounded-xl border border-border p-3" key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold font-mono">{money(value)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Requests" value={usage.requests} />
        <Stat label="Input tokens" value={usage.inputTokens} />
        <Stat label="Output tokens" value={usage.outputTokens} />
      </div>

      <p className="text-sm">Progress: <strong>{progress.done}</strong> / {progress.total} tasks</p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              {['ID', 'Type', 'Chapter', 'Status', 'Model', 'Attempts', 'Cost', 'Error'].map((h) => <th className="py-2 pr-3 font-medium" key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr className="border-b border-border/50 align-top" key={t.id}>
                <td className="py-2 pr-3 font-mono">{t.id}</td>
                <td className="py-2 pr-3">{t.type}</td>
                <td className="py-2 pr-3">{t.chapter ?? '-'}</td>
                <td className="py-2 pr-3">{t.status}</td>
                <td className="py-2 pr-3 font-mono">{t.model}</td>
                <td className="py-2 pr-3">{t.attempts}</td>
                <td className="py-2 pr-3 font-mono">{money(t.cost)}</td>
                <td className="py-2 pr-3 text-destructive">{t.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Logs</h3>
        <div className="h-64 overflow-y-auto rounded-xl bg-background border border-border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {logs.slice(-200).map((log, i) => <div key={i}>{log.message}</div>)}
          <div ref={logEnd} />
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold font-mono">{value.toLocaleString()}</div>
    </div>
  )
}

function ManuscriptPanel({ bookAuthor, bookTitle, view }: { bookAuthor: string; bookTitle: string; view: NovellaView }) {
  const [openNo, setOpenNo] = useState<number | null>(null)
  const { chapters, issues } = view
  const chapter = chapters.find((c) => c.number === openNo) ?? null

  const doc: ExportDoc = {
    title: view.brief.title || bookTitle,
    author: bookAuthor,
    date: new Date().toISOString().slice(0, 10),
    chapters: chapters.map((c) => ({ number: c.number, title: c.title, content: c.content })),
  }
  const problems = chapters.length ? validateDoc(doc) : ['No chapters to export yet']
  const slug = (doc.title || 'novella').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'novella'

  function download(name: string, data: string | Uint8Array, type: string) {
    const part = typeof data === 'string' ? data : new Uint8Array(data)
    const url = URL.createObjectURL(new Blob([part], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const exporters = {
    md: () => download(`${slug}.md`, buildMarkdown(doc), 'text/markdown'),
    txt: () => download(`${slug}.txt`, buildText(doc), 'text/plain'),
    epub: () => download(`${slug}.epub`, buildEpub(doc), 'application/epub+zip'),
    pdf: () => download(`${slug}.pdf`, buildPdf(doc), 'application/pdf'),
  } as const

  return (
    <section className="flex flex-col gap-6 bg-card p-6 rounded-2xl border border-border">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">C. Manuscript</h2>
        <div className="flex gap-2">
          {(Object.keys(exporters) as Array<keyof typeof exporters>).map((fmt) => (
            <button className="px-3 py-1.5 rounded-xl border border-border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50" disabled={problems.length > 0} key={fmt} onClick={exporters[fmt]} type="button">
              <Download size={14} /> {fmt === 'md' ? 'Markdown' : fmt === 'txt' ? 'TXT' : fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="text-xs text-destructive list-disc pl-5">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ul className="flex flex-col gap-2">
          {chapters.map((c) => (
            <li key={c.number}>
              <button className={`w-full text-left p-3 rounded-xl border text-sm flex justify-between items-center gap-3 ${openNo === c.number ? 'border-primary' : 'border-border hover:border-primary/50'}`} onClick={() => setOpenNo(c.number)} type="button">
                <span className="font-medium">{c.number}. {c.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.revised && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">Revised</span>}
                  {wordCountOf(c.content).toLocaleString()} words
                </span>
              </button>
            </li>
          ))}
          {chapters.length === 0 && <li className="text-sm text-muted-foreground">No chapters yet.</li>}
        </ul>

        {chapter && (
          <article className="font-serif text-base leading-relaxed whitespace-pre-wrap bg-background border border-border rounded-xl p-5 max-h-[70vh] overflow-y-auto">
            <h3 className="font-display text-lg font-semibold mb-4 whitespace-normal">{chapter.title}</h3>
            {chapter.content}
          </article>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Issues</h3>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issues recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {issues.map((issue, i) => (
              <li className="rounded-xl border border-border p-3" key={i}>
                <div className="text-xs font-medium uppercase text-muted-foreground">{issue.severity} · chapter {issue.chapter ?? '-'}</div>
                <p>{issue.evidence}</p>
                {issue.fix && <p className="text-muted-foreground mt-1">Fix: {issue.fix}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function wordCountOf(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function emptyBrief(title: string): Brief {
  return { title, genre: '', tone: '', pov: '', tense: '', premise: '', characters: '', setting: '', ending: '', plotPoints: '' }
}
