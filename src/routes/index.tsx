import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { BookOpen, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { Book } from '#/lib/books.server'

const getBooks = createServerFn({ method: 'GET' }).handler(async () => {
  const { listBooks } = await import('#/lib/books.server')
  return listBooks()
})

const addBook = createServerFn({ method: 'POST' })
  .validator(z.object({ title: z.string().max(160) }))
  .handler(async ({ data }) => {
    const { createBook } = await import('#/lib/books.server')
    return createBook(data.title || 'Untitled')
  })

export const Route = createFileRoute('/')({
  loader: () => getBooks(),
  component: LibraryPage,
})

function LibraryPage() {
  const books = Route.useLoaderData() as Array<Book>
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'complete'>('all')
  const [creating, setCreating] = useState(false)
  const filteredBooks = books.filter((book) => {
    const matchesFilter = filter === 'all' || book.status === filter
    const matchesQuery = `${book.title} ${book.author} ${book.genre}`
      .toLowerCase()
      .includes(query.toLowerCase())
    return matchesFilter && matchesQuery
  })

  async function handleCreateBook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || creating) return
    setCreating(true)
    try {
      const book = await addBook({ data: { title: title.trim() } })
      if (book && book.id) {
        await navigate({ to: '/books/$bookId', params: { bookId: book.id } })
      }
    } finally {
      setCreating(false)
    }
  }

  const drafts = books.filter((book) => book.status === 'draft').length
  const complete = books.filter((book) => book.status === 'complete').length

  return (
    <main className="studio-main p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8 bg-card p-6 rounded-2xl border border-border">
        <div>
          <p className="text-xs uppercase tracking-wider text-primary font-semibold mb-1">YOUR WRITING DESK</p>
          <h1 className="text-3xl font-bold font-display text-foreground">Your library</h1>
          <p className="text-muted-foreground text-sm mt-1">A quiet place for the stories only you can tell.</p>
        </div>
        <div className="flex gap-6 text-right">
          <div><div className="text-2xl font-bold">{books.length}</div><div className="text-xs text-muted-foreground">BOOKS</div></div>
          <div><div className="text-2xl font-bold">{drafts}</div><div className="text-xs text-muted-foreground">IN PROGRESS</div></div>
          <div><div className="text-2xl font-bold">{complete}</div><div className="text-xs text-muted-foreground">FINISHED</div></div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-display font-semibold">Bookshelf</h2>
      </div>

      <form className="flex gap-3 mb-6 bg-card p-4 rounded-2xl border border-border" onSubmit={handleCreateBook}>
        <BookOpen className="text-muted-foreground self-center" size={20} />
        <input
          className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground text-sm"
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Give your next book a working title..."
          value={title}
        />
        <button className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-50" disabled={!title.trim() || creating} type="submit">
          <Plus size={16} />
          {creating ? 'Creating...' : 'New book'}
        </button>
      </form>

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex gap-2">
          {(['all', 'draft', 'complete'] as const).map((value) => (
            <button
              className={`px-4 py-2 rounded-xl text-xs font-medium transition ${filter === value ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:text-foreground'}`}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value === 'all' ? 'All books' : value === 'draft' ? 'In progress' : 'Finished'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-card px-3 py-2 rounded-xl border border-border w-72">
          <Search size={16} className="text-muted-foreground" />
          <input className="bg-transparent border-none outline-none text-sm w-full" onChange={(event) => setQuery(event.target.value)} placeholder="Find a book..." value={query} />
        </div>
      </div>

      {filteredBooks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {filteredBooks.map((book) => <BookCard book={book} key={book.id} />)}
        </div>
      ) : (
        <div className="text-center py-20 bg-card rounded-2xl border border-border p-8">
          <BookOpen className="mx-auto text-muted-foreground mb-4" size={40} strokeWidth={1.5} />
          <h3 className="text-lg font-semibold mb-1">No books found</h3>
          <p className="text-sm text-muted-foreground">Start your first book with a title above.</p>
        </div>
      )}
    </main>
  )
}

function BookCard({ book }: { book: Book }) {
  const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(book.updatedAt))
  const words = book.content.trim() ? book.content.trim().split(/\s+/).length : 0

  return (
    <Link className="group block bg-card rounded-2xl border border-border p-6 hover:border-primary/50 transition shadow-sm" params={{ bookId: book.id }} to="/books/$bookId">
      <div className="flex justify-between items-start mb-4">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${book.status === 'complete' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
          {book.status === 'complete' ? 'Finished' : 'In progress'}
        </span>
        <span className="text-xs text-muted-foreground">{words.toLocaleString()} words</span>
      </div>
      <h3 className="text-xl font-display font-bold mb-1 group-hover:text-primary transition">{book.title}</h3>
      <p className="text-xs text-muted-foreground mb-4">{book.genre || 'Untitled genre'} {book.author ? `· ${book.author}` : ''}</p>
      <div className="text-xs text-muted-foreground border-t border-border pt-3 flex justify-between items-center">
        <span>Edited {date}</span>
        <span className="text-primary font-medium group-hover:translate-x-1 transition-transform inline-block">Open →</span>
      </div>
    </Link>
  )
}
