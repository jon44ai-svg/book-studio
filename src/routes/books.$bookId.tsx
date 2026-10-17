import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Save, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import type { Book } from "#/lib/books.server";

const getBook = createServerFn({ method: "GET" })
	.validator(z.string())
	.handler(async ({ data: id }) => {
		const { getBook: readBook } = await import("#/lib/books.server");
		return readBook(id);
	});

const saveBook = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.string(),
			title: z.string().max(160),
			author: z.string().max(160),
			genre: z.string().max(80),
			summary: z.string().max(1200),
			content: z.string(),
			status: z.enum(["draft", "complete"]),
		}),
	)
	.handler(async ({ data }) => {
		const { updateBook } = await import("#/lib/books.server");
		return updateBook(data.id, data);
	});

const removeBook = createServerFn({ method: "POST" })
	.validator(z.string())
	.handler(async ({ data: id }) => {
		const { deleteBook } = await import("#/lib/books.server");
		await deleteBook(id);
	});

export const Route = createFileRoute("/books/$bookId")({
	loader: ({ params }) => getBook({ data: params.bookId }),
	component: BookEditor,
});

function BookEditor() {
	const initialBook = Route.useLoaderData() as Book | null;
	const navigate = useNavigate();
	const [book, setBook] = useState<Book | null>(initialBook);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	if (!book) {
		return (
			<main className="max-w-xl mx-auto py-24 text-center">
				<p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
					THIS PAGE IS TURNED
				</p>
				<h1 className="text-2xl font-bold font-display mb-4">
					Book not found.
				</h1>
				<Link
					className="text-primary hover:underline text-sm font-medium"
					to="/"
				>
					Return to your library
				</Link>
			</main>
		);
	}

	const wordCount = book.content.trim()
		? book.content.trim().split(/\s+/).length
		: 0;

	function update(field: keyof Book, value: string) {
		setBook((current) => (current ? { ...current, [field]: value } : current));
		setSaved(false);
	}

	async function handleSave(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!book || saving) return;
		setSaving(true);
		try {
			const updated = await saveBook({
				data: {
					id: book.id,
					title: book.title,
					author: book.author,
					genre: book.genre,
					summary: book.summary,
					content: book.content,
					status: book.status,
				},
			});
			if (updated) {
				setBook(updated as Book);
				setSaved(true);
			}
		} finally {
			setSaving(false);
		}
	}

	async function remove() {
		if (
			!book ||
			!window.confirm(`Delete “${book.title}”? This cannot be undone.`)
		)
			return;
		await removeBook({ data: book.id });
		await navigate({ to: "/" });
	}

	return (
		<main className="max-w-7xl mx-auto p-6">
			<div className="flex justify-between items-center mb-6 pb-4 border-b border-border">
				<Link
					className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition"
					to="/"
				>
					<ArrowLeft size={16} /> Library
				</Link>
				<div className="flex items-center gap-3">
					<span
						className="text-xs text-muted-foreground flex items-center gap-1.5"
						aria-live="polite"
					>
						{saved ? (
							<>
								<Check size={14} className="text-emerald-500" /> Saved just now
							</>
						) : (
							"Unsaved changes"
						)}
					</span>
					<Link
						className="px-3 py-2 rounded-xl border border-border text-sm font-medium hover:text-primary transition flex items-center gap-1.5"
						params={{ bookId: book.id }}
						to="/novella/$bookId"
					>
						<Sparkles size={16} /> Novella engine
					</Link>
					<button
						className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20 text-sm font-medium transition flex items-center gap-1.5"
						onClick={() => void remove()}
						type="button"
					>
						<Trash2 size={16} /> Delete
					</button>
					<button
						className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition flex items-center gap-1.5 disabled:opacity-50"
						disabled={saving}
						form="book-form"
						type="submit"
					>
						<Save size={16} /> {saving ? "Saving..." : "Save book"}
					</button>
				</div>
			</div>

			<form
				id="book-form"
				className="grid grid-cols-1 lg:grid-cols-3 gap-8"
				onSubmit={handleSave}
			>
				<div className="lg:col-span-2 flex flex-col gap-4 bg-card p-6 rounded-2xl border border-border">
					<div className="flex justify-between items-center">
						<span className="text-xs font-semibold text-muted-foreground uppercase">
							THE MANUSCRIPT
						</span>
						<select
							className="bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-medium"
							onChange={(event) => update("status", event.target.value)}
							value={book.status}
						>
							<option value="draft">In progress</option>
							<option value="complete">Finished</option>
						</select>
					</div>
					<textarea
						className="w-full h-[60vh] bg-transparent border border-border rounded-xl p-4 font-serif text-lg leading-relaxed outline-none focus:border-primary resize-none"
						onChange={(event) => update("content", event.target.value)}
						placeholder="Start writing here. This is your space..."
						value={book.content}
					/>
					<div className="flex justify-between text-xs text-muted-foreground">
						<span>{wordCount.toLocaleString()} words</span>
						<span>Manual save mode</span>
					</div>
				</div>

				<div className="bg-card p-6 rounded-2xl border border-border flex flex-col gap-4 h-fit">
					<p className="text-xs font-semibold text-muted-foreground uppercase">
						BOOK DETAILS
					</p>
					<div>
						<label
							className="block text-xs font-medium mb-1"
							htmlFor="book-title"
						>
							Title
						</label>
						<input
							className="w-full bg-background border border-border rounded-xl px-3.5 py-2 text-sm outline-none focus:border-primary"
							id="book-title"
							maxLength={160}
							onChange={(event) => update("title", event.target.value)}
							required
							value={book.title}
						/>
					</div>
					<div>
						<label
							className="block text-xs font-medium mb-1"
							htmlFor="book-author"
						>
							Author
						</label>
						<input
							className="w-full bg-background border border-border rounded-xl px-3.5 py-2 text-sm outline-none focus:border-primary"
							id="book-author"
							maxLength={160}
							onChange={(event) => update("author", event.target.value)}
							placeholder="Your name"
							value={book.author}
						/>
					</div>
					<div>
						<label
							className="block text-xs font-medium mb-1"
							htmlFor="book-genre"
						>
							Genre
						</label>
						<input
							className="w-full bg-background border border-border rounded-xl px-3.5 py-2 text-sm outline-none focus:border-primary"
							id="book-genre"
							maxLength={80}
							onChange={(event) => update("genre", event.target.value)}
							placeholder="Literary fiction, memoir..."
							value={book.genre}
						/>
					</div>
					<div>
						<label
							className="block text-xs font-medium mb-1"
							htmlFor="book-summary"
						>
							Synopsis
						</label>
						<textarea
							className="w-full h-28 bg-background border border-border rounded-xl p-3 text-sm outline-none focus:border-primary resize-none"
							id="book-summary"
							maxLength={1200}
							onChange={(event) => update("summary", event.target.value)}
							placeholder="A short description..."
							value={book.summary}
						/>
					</div>
				</div>
			</form>
		</main>
	);
}
