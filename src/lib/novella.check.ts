import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";

import type { NovellaView, Settings } from "./novella.server";
import { selfCheck as exportSelfCheck } from "./novella-export";

type RequestStats = {
	total: number;
	active: number;
	maxActive: number;
	failures?: Array<"truncated" | "json_validate_failed">;
};

type Runner = typeof import("./novella.server");
type Books = typeof import("./books.server");

let server: Server | undefined;
let databasePath: string | undefined;
let runner: Runner | undefined;
let books: Books | undefined;

const brief = {
	title: "A Small Test Novella",
	genre: "literary fiction",
	tone: "warm",
	pov: "third person",
	tense: "past",
	premise: "A town remembers what it tried to forget.",
	characters: "Mara, a careful archivist.",
	setting: "A coastal town.",
	ending: "Mara tells the truth.",
	plotPoints: "Discovery, conflict, reconciliation.",
};

function invariant<T>(value: T | null | undefined, message: string): T {
	if (value == null) throw new Error(message);
	return value;
}

function settings(overrides: Partial<Settings> = {}): Settings {
	return {
		planner: "fake-model",
		writer: "fake-model",
		auditor: "fake-model",
		editor: "fake-model",
		fallbackModel: "",
		pricing: { "fake-model": { input: 1, output: 1 } },
		totalUsd: 1,
		draftingUsd: 0.7,
		reserveUsd: 0.3,
		chapterCount: 4,
		targetWords: 400,
		reviseRounds: 0,
		maxConcurrent: 4,
		perModelConcurrency: 4,
		retryMax: 0,
		...overrides,
	};
}

function responseFor(user: string): Record<string, unknown> {
	const chapter = /Write chapter (\d+)/.exec(user)?.[1];
	if (chapter) {
		return {
			title: `Chapter ${chapter}`,
			content: `The story of chapter ${chapter} moved forward.`,
		};
	}
	if (user.includes("Find concrete continuity")) return { issues: [] };
	if (user.includes("Apply targeted fixes")) return { chapters: [] };
	return { result: "completed" };
}

async function startFakeOpenAi(stats: RequestStats): Promise<string> {
	server = createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
			response.writeHead(404).end();
			return;
		}

		stats.total++;
		stats.active++;
		stats.maxActive = Math.max(stats.maxActive, stats.active);
		let body = "";
		for await (const chunk of request) body += chunk;
		const payload = JSON.parse(body) as {
			messages?: Array<{ content?: string }>;
		};
		await new Promise((resolve) => setTimeout(resolve, 25));
		stats.active--;
		const failure = stats.failures?.shift();
		if (failure === "json_validate_failed") {
			response.writeHead(400, { "Content-Type": "application/json" }).end(
				JSON.stringify({
					error: {
						code: "json_validate_failed",
						message: "Failed to validate JSON response before completion limit",
					},
				}),
			);
			return;
		}
		response.writeHead(200, { "Content-Type": "application/json" }).end(
			JSON.stringify({
				choices: [
					{
						message: {
							content:
								failure === "truncated"
									? '{"result":"incomplete'
									: JSON.stringify(
											responseFor(payload.messages?.[1]?.content ?? ""),
										),
						},
					},
				],
				usage: { prompt_tokens: 100, completion_tokens: 50 },
			}),
		);
	});
	const fakeServer = invariant(server, "Fake server was not created");
	await new Promise<void>((resolve) =>
		fakeServer.listen(0, "127.0.0.1", resolve),
	);
	const address = fakeServer.address();
	if (!address || typeof address === "string")
		throw new Error("Fake server did not bind");
	return `http://127.0.0.1:${address.port}/v1`;
}

async function waitFor(
	bookId: string,
	predicate: (view: NovellaView) => boolean,
): Promise<NovellaView> {
	let latest: NovellaView | null = null;
	for (let attempt = 0; attempt < 200; attempt++) {
		latest = invariant(
			await invariant(runner, "Novella runner is not loaded").getNovella(
				bookId,
			),
			`Novella ${bookId} was not found`,
		);
		if (predicate(latest)) return latest;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(
		`Timed out waiting for novella ${bookId}: ${latest?.status}; ` +
			`${latest?.tasks.map((task) => `${task.type}:${task.status}:${task.error ?? ""}`).join(", ")}; ` +
			`${latest?.logs.map((log) => log.message).join(" | ")}`,
	);
}

export async function selfCheck(): Promise<void> {
	exportSelfCheck();
	databasePath = await mkdtemp(
		join(tmpdir(), "book-studio-novella-check-"),
	).then((dir) => join(dir, "books.sqlite"));
	const stats: RequestStats = { total: 0, active: 0, maxActive: 0 };
	process.env.BOOK_STUDIO_DB_PATH = databasePath;
	process.env.GROQ_BASE_URL = await startFakeOpenAi(stats);
	process.env.GROQ_API_KEY = "novella-self-check";

	runner = await import("./novella.server");
	books = await import("./books.server");
	const novellaRunner = invariant(runner, "Novella runner is not loaded");
	const bookStore = invariant(books, "Book store is not loaded");
	const book = await bookStore.createBook(brief.title);
	const initial = await novellaRunner.saveBrief(book.id, brief, settings());
	expect(initial.status).toBe("idle");

	await novellaRunner.startRun(book.id);
	const completed = await waitFor(
		book.id,
		(view) => view.status === "completed",
	);
	expect(
		completed.tasks
			.filter((task) => task.status === "completed")
			.map((task) => task.type),
	).toEqual([
		"planner",
		"bible",
		"outline",
		"writer",
		"writer",
		"writer",
		"writer",
		"auditor",
		"editor",
	]);
	expect(completed.chapters).toHaveLength(4);
	expect(completed.usage.requests).toBe(8);
	expect(stats.maxActive).toBeGreaterThan(1);
	expect(completed.budget.spent).toBeLessThanOrEqual(completed.budget.total);
	expect(completed.budget.reserved).toBe(0);
	expect(completed.tasks.every((task) => task.reservedUsd === 0)).toBe(true);

	const requestsAfterCompletion = stats.total;
	expect((await novellaRunner.startRun(book.id)).status).toBe("completed");
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(stats.total).toBe(requestsAfterCompletion);

	const exhaustedBook = await bookStore.createBook("Budget Exhaustion");
	await novellaRunner.saveBrief(
		exhaustedBook.id,
		brief,
		settings({
			totalUsd: 0.0001,
			draftingUsd: 0.00005,
			reserveUsd: 0.00005,
			chapterCount: 1,
		}),
	);
	await novellaRunner.startRun(exhaustedBook.id);
	const exhausted = await waitFor(
		exhaustedBook.id,
		(view) => view.status === "budget_exhausted",
	);
	expect(exhausted.budget.spent).toBe(0);
	expect(exhausted.budget.reserved).toBe(0);
	expect(exhausted.usage.requests).toBe(0);
	expect(exhausted.tasks[0]?.status).toBe("queued");

	stats.failures = ["json_validate_failed", "truncated"];
	const malformedBook = await bookStore.createBook("Malformed JSON Recovery");
	await novellaRunner.saveBrief(
		malformedBook.id,
		brief,
		settings({ retryMax: 2 }),
	);
	await novellaRunner.startRun(malformedBook.id);
	const recovered = await waitFor(
		malformedBook.id,
		(view) => view.status === "completed",
	);
	expect(recovered.tasks.every((task) => task.status === "completed")).toBe(
		true,
	);
	expect(stats.total).toBe(18);
	expect(recovered.budget.reserved).toBe(0);
	expect(recovered.tasks.every((task) => task.reservedUsd === 0)).toBe(true);
}

test("novella runner self-check", async () => {
	await selfCheck();
}, 15_000);

afterAll(async () => {
	await new Promise<void>((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
	});
	if (databasePath) await rm(databasePath, { force: true });
	if (databasePath) await rm(`${databasePath}-wal`, { force: true });
	if (databasePath) await rm(`${databasePath}-shm`, { force: true });
	delete process.env.BOOK_STUDIO_DB_PATH;
	delete process.env.GROQ_BASE_URL;
	delete process.env.GROQ_API_KEY;
});
