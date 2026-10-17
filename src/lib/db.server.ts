import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { neon } from "@neondatabase/serverless";

const connectionString =
	process.env.DATABASE_URL ||
	process.env.POSTGRES_URL ||
	process.env.POSTGRES_PRISMA_URL;

const sqlite = connectionString
	? null
	: (() => {
			const databasePath = resolve(
				process.env.BOOK_STUDIO_DB_PATH || "data/books.sqlite",
			);
			mkdirSync(dirname(databasePath), { recursive: true });
			const database = new DatabaseSync(databasePath);
			database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
			return database;
		})();

const postgres = connectionString ? neon(connectionString) : null;

const schema = `
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    cover TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    book_id TEXT PRIMARY KEY, brief TEXT NOT NULL, settings TEXT NOT NULL,
    status TEXT NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
    reserved_usd REAL NOT NULL DEFAULT 0, uncertain_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, type TEXT NOT NULL,
    chapter_number INTEGER, deps TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
    model TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, reserved_usd REAL NOT NULL DEFAULT 0,
    error TEXT, result TEXT, envelope TEXT NOT NULL DEFAULT 'drafting'
  );
  CREATE TABLE IF NOT EXISTS usage (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, book_id TEXT NOT NULL,
    attempt INTEGER NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    reserved_usd REAL NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chapters (
    book_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '', revised INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, number)
  );
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, severity TEXT NOT NULL,
    chapter_number INTEGER, evidence TEXT NOT NULL, fix TEXT
  );
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export const usingNeon = Boolean(connectionString);
const initialized = (async () => {
	if (postgres) {
		for (const statement of schema
			.split(";")
			.map((part) => part.trim())
			.filter(Boolean)) {
			await postgres.query(statement);
		}
	} else {
		if (!sqlite) throw new Error("SQLite database is unavailable");
		sqlite.exec(schema);
	}
})();

function postgresQuery(query: string, params: unknown[]) {
	if (!postgres) throw new Error("Postgres database is unavailable");
	let index = 0;
	const text = query.replace(/\?/g, () => `$${++index}`);
	return postgres.query(text, params);
}

type Statement = {
	all: (...params: unknown[]) => Promise<unknown[]>;
	get: (...params: unknown[]) => Promise<unknown>;
	run: (...params: unknown[]) => Promise<void>;
};

export const db = {
	prepare(query: string): Statement {
		return {
			all: async (...params) => {
				await initialized;
				if (postgres) return postgresQuery(query, params);
				if (!sqlite) throw new Error("SQLite database is unavailable");
				return sqlite.prepare(query).all(...(params as never[])) as unknown[];
			},
			get: async (...params) => {
				await initialized;
				if (postgres) {
					const rows = await postgresQuery(query, params);
					return rows[0];
				}
				if (!sqlite) throw new Error("SQLite database is unavailable");
				return sqlite.prepare(query).get(...(params as never[]));
			},
			run: async (...params) => {
				await initialized;
				if (postgres) {
					await postgresQuery(query, params);
				} else {
					if (!sqlite) throw new Error("SQLite database is unavailable");
					sqlite.prepare(query).run(...(params as never[]));
				}
			},
		};
	},
};
