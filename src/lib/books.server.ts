import { randomUUID } from 'node:crypto'
import { db as database } from './db.server'

export type Book = {
  id: string
  title: string
  author: string
  genre: string
  summary: string
  content: string
  status: 'draft' | 'complete'
  cover: 'terracotta' | 'sage' | 'blue' | 'plum'
  createdAt: string
  updatedAt: string
}

database.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
    cover TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)

export function listBooks(): Array<Book> {
  return database.prepare(`
    SELECT id, title, author, genre, summary, content, status, cover,
      created_at AS createdAt, updated_at AS updatedAt
    FROM books ORDER BY updated_at DESC
  `).all() as unknown as Array<Book>
}

export function getBook(id: string): Book | null {
  return (database.prepare(`
    SELECT id, title, author, genre, summary, content, status, cover,
      created_at AS createdAt, updated_at AS updatedAt
    FROM books WHERE id = ?
  `).get(id) as Book | undefined) ?? null
}

export function createBook(title: string): Book {
  const id = randomUUID()
  const now = new Date().toISOString()
  const covers: Array<Book['cover']> = ['terracotta', 'sage', 'blue', 'plum']
  const cover = covers[listBooks().length % covers.length]!
  database.prepare(`
    INSERT INTO books (id, title, cover, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(id, title.trim(), cover, now, now)
  return getBook(id)!
}

export function updateBook(id: string, book: Omit<Book, 'id' | 'createdAt' | 'updatedAt' | 'cover'>): Book | null {
  database.prepare(`
    UPDATE books SET title = ?, author = ?, genre = ?, summary = ?, content = ?,
      status = ?, updated_at = ? WHERE id = ?
  `).run(book.title.trim(), book.author.trim(), book.genre.trim(), book.summary.trim(), book.content, book.status, new Date().toISOString(), id)
  return getBook(id)
}

export function deleteBook(id: string): void {
  database.prepare('DELETE FROM books WHERE id = ?').run(id)
}
