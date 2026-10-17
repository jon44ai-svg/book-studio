import { access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourcePath = resolve(
	sourceArg?.slice("--source=".length) ?? process.env.BOOK_STUDIO_DB_PATH ?? "data/books.sqlite",
);
const connectionString =
	process.env.DATABASE_URL ??
	process.env.POSTGRES_URL ??
	process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
	throw new Error(
		"DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL is required",
	);
}

await access(sourcePath);
const source = new DatabaseSync(sourcePath, { readOnly: true });
const sql = neon(connectionString);

const schema = [
	`CREATE TABLE IF NOT EXISTS books (
		id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
		genre TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
		content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
		cover TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS projects (
		book_id TEXT PRIMARY KEY, brief TEXT NOT NULL, settings TEXT NOT NULL,
		status TEXT NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
		reserved_usd REAL NOT NULL DEFAULT 0, uncertain_usd REAL NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY, book_id TEXT NOT NULL, type TEXT NOT NULL,
		chapter_number INTEGER, deps TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
		model TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
		cost_usd REAL NOT NULL DEFAULT 0, reserved_usd REAL NOT NULL DEFAULT 0,
		error TEXT, result TEXT, envelope TEXT NOT NULL DEFAULT 'drafting'
	)`,
	`CREATE TABLE IF NOT EXISTS usage (
		id TEXT PRIMARY KEY, task_id TEXT NOT NULL, book_id TEXT NOT NULL,
		attempt INTEGER NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
		output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
		reserved_usd REAL NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0,
		error TEXT, created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS chapters (
		book_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
		content TEXT NOT NULL DEFAULT '', revised INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (book_id, number)
	)`,
	`CREATE TABLE IF NOT EXISTS issues (
		id TEXT PRIMARY KEY, book_id TEXT NOT NULL, severity TEXT NOT NULL,
		chapter_number INTEGER, evidence TEXT NOT NULL, fix TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS logs (
		id TEXT PRIMARY KEY, book_id TEXT NOT NULL, message TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`,
];

for (const statement of schema) await sql.query(statement);

const tables = [
	{
		name: "books",
		columns: [
			"id",
			"title",
			"author",
			"genre",
			"summary",
			"content",
			"status",
			"cover",
			"created_at",
			"updated_at",
		],
		key: "id",
	},
	{
		name: "projects",
		columns: [
			"book_id",
			"brief",
			"settings",
			"status",
			"spent_usd",
			"reserved_usd",
			"uncertain_usd",
			"updated_at",
		],
		key: "book_id",
	},
	{
		name: "tasks",
		columns: [
			"id",
			"book_id",
			"type",
			"chapter_number",
			"deps",
			"status",
			"model",
			"attempts",
			"cost_usd",
			"reserved_usd",
			"error",
			"result",
			"envelope",
		],
		key: "id",
	},
	{
		name: "usage",
		columns: [
			"id",
			"task_id",
			"book_id",
			"attempt",
			"model",
			"input_tokens",
			"output_tokens",
			"cost_usd",
			"reserved_usd",
			"uncertain",
			"error",
			"created_at",
		],
		key: "id",
	},
	{
		name: "chapters",
		columns: ["book_id", "number", "title", "content", "revised"],
		key: ["book_id", "number"],
	},
	{
		name: "issues",
		columns: ["id", "book_id", "severity", "chapter_number", "evidence", "fix"],
		key: "id",
	},
	{
		name: "logs",
		columns: ["id", "book_id", "message", "created_at"],
		key: "id",
	},
];

function normalize(value) {
	return value === undefined ? null : value;
}

async function migrateTable(table) {
	const rows = source
		.prepare(`SELECT ${table.columns.join(", ")} FROM ${table.name}`)
		.all();
	const quotedColumns = table.columns.join(", ");
	const placeholders = table.columns.map((_, index) => `$${index + 1}`).join(", ");
	const keys = Array.isArray(table.key) ? table.key : [table.key];
	const updates = table.columns
		.filter((column) => !keys.includes(column))
		.map((column) => `${column}=EXCLUDED.${column}`)
		.join(", ");
	const statement = `INSERT INTO ${table.name} (${quotedColumns}) VALUES (${placeholders})
		ON CONFLICT (${keys.join(", ")}) DO UPDATE SET ${updates}`;

	for (const row of rows) {
		await sql.query(
			statement,
			table.columns.map((column) => normalize(row[column])),
		);
	}
	console.log(`${table.name}: ${rows.length} row(s) migrated`);
}

for (const table of tables) await migrateTable(table);

source.close();
console.log(`SQLite migration complete from ${sourcePath}`);
