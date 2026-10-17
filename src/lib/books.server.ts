import { randomUUID } from "node:crypto";
import { db as database } from "./db.server";

export type Book = {
	id: string;
	title: string;
	author: string;
	genre: string;
	summary: string;
	content: string;
	status: "draft" | "complete";
	cover: "terracotta" | "sage" | "blue" | "plum";
	createdAt: string;
	updatedAt: string;
};

export async function listBooks(): Promise<Array<Book>> {
	return (await database
		.prepare(`
	    SELECT id, title, author, genre, summary, content, status, cover,
	      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM books ORDER BY updated_at DESC
  `)
		.all()) as unknown as Array<Book>;
}

export async function getBook(id: string): Promise<Book | null> {
	return (
		((await database
			.prepare(`
	    SELECT id, title, author, genre, summary, content, status, cover,
	      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM books WHERE id = ?
  `)
			.get(id)) as Book | undefined) ?? null
	);
}

export async function createBook(title: string): Promise<Book> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const covers: Array<Book["cover"]> = ["terracotta", "sage", "blue", "plum"];
	const cover =
		covers[(await listBooks()).length % covers.length] ?? "terracotta";
	await database
		.prepare(`
    INSERT INTO books (id, title, cover, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
  `)
		.run(id, title.trim(), cover, now, now);
	const created = await getBook(id);
	if (!created) throw new Error("Book was not created");
	return created;
}

export async function updateBook(
	id: string,
	book: Omit<Book, "id" | "createdAt" | "updatedAt" | "cover">,
): Promise<Book | null> {
	await database
		.prepare(`
    UPDATE books SET title = ?, author = ?, genre = ?, summary = ?, content = ?,
      status = ?, updated_at = ? WHERE id = ?
  `)
		.run(
			book.title.trim(),
			book.author.trim(),
			book.genre.trim(),
			book.summary.trim(),
			book.content,
			book.status,
			new Date().toISOString(),
			id,
		);
	return getBook(id);
}

export async function deleteBook(id: string): Promise<void> {
	await database.prepare("DELETE FROM books WHERE id = ?").run(id);
}
