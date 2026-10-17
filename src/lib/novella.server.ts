import { randomUUID } from "node:crypto";
import { getBook } from "./books.server";
import { db } from "./db.server";
import { chatOnce, GroqError } from "./groq.server";
import { getEffectiveGroqCredential } from "./groq-credentials.server";

export type Brief = {
	title: string;
	genre: string;
	tone: string;
	pov: string;
	tense: string;
	premise: string;
	characters: string;
	setting: string;
	ending: string;
	plotPoints: string;
};
export type Settings = {
	planner: string;
	writer: string;
	auditor: string;
	editor: string;
	fallbackModel?: string;
	pricing: Record<string, { input: number; output: number }>;
	totalUsd: number;
	draftingUsd: number;
	reserveUsd: number;
	chapterCount: number;
	targetWords: number;
	reviseRounds: number;
	maxConcurrent: number;
	perModelConcurrency: number;
	retryMax: number;
};
export type RunStatus =
	| "idle"
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "budget_exhausted";
export type TaskStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "paused";
export type TaskView = {
	id: string;
	type: string;
	chapter?: number | null;
	chapterNumber?: number | null;
	status: TaskStatus;
	model: string;
	attempts: number;
	cost: number;
	costUsd?: number;
	reservedUsd: number;
	error?: string | null;
};
export type ChapterView = {
	number: number;
	title: string;
	content: string;
	wordCount: number;
	revised: boolean;
};
export type IssueView = {
	id: string;
	severity: string;
	chapter?: number | null;
	evidence: string;
	fix?: string | null;
};
export type NovellaView = {
	bookId: string;
	brief: Brief;
	settings: Settings;
	status: RunStatus;
	budget: {
		total: number;
		spent: number;
		reserved: number;
		uncertain: number;
		draftingRemaining: number;
		reserveRemaining: number;
		totalRemaining: number;
	};
	usage: { requests: number; inputTokens: number; outputTokens: number };
	progress: { done: number; total: number };
	tasks: TaskView[];
	chapters: ChapterView[];
	issues: IssueView[];
	logs: Array<{ id: string; message: string; createdAt: string }>;
};

type TaskRow = TaskView & {
	deps: string;
	result: string | null;
	envelope: "drafting" | "reserve";
};
type ProjectRow = {
	book_id: string;
	brief: string;
	settings: string;
	status: RunStatus;
};
type Active = { running: number; models: Map<string, number>; paused: boolean };

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    book_id TEXT PRIMARY KEY, brief TEXT NOT NULL, settings TEXT NOT NULL,
    status TEXT NOT NULL, spent_usd REAL NOT NULL DEFAULT 0,
    reserved_usd REAL NOT NULL DEFAULT 0, uncertain_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, type TEXT NOT NULL,
    chapter_number INTEGER, deps TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
    model TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    reserved_usd REAL NOT NULL DEFAULT 0, error TEXT, result TEXT,
    envelope TEXT NOT NULL DEFAULT 'drafting'
  );
  CREATE TABLE IF NOT EXISTS usage (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, book_id TEXT NOT NULL, attempt INTEGER NOT NULL,
    model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0, reserved_usd REAL NOT NULL DEFAULT 0,
    uncertain INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL
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
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
  );
`);

const active = new Map<string, Active>();
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: string): T => JSON.parse(value) as T;
function invariant<T>(value: T | null | undefined, message: string): T {
	if (value == null) throw new Error(message);
	return value;
}

export function defaultSettings(): Settings {
	return {
		planner: "llama-3.3-70b-versatile",
		writer: "llama-3.3-70b-versatile",
		auditor: "llama-3.3-70b-versatile",
		editor: "llama-3.3-70b-versatile",
		fallbackModel: "",
		pricing: {},
		totalUsd: 2,
		draftingUsd: 1.3,
		reserveUsd: 0.7,
		chapterCount: 12,
		targetWords: 15000,
		reviseRounds: 0,
		maxConcurrent: 4,
		perModelConcurrency: 2,
		retryMax: 3,
	};
}

export function validateSettings(s: Settings): string[] {
	const errors: string[] = [];
	if (s.totalUsd < 0 || s.draftingUsd < 0 || s.reserveUsd < 0)
		errors.push("Budgets cannot be negative");
	if (s.draftingUsd + s.reserveUsd > s.totalUsd)
		errors.push("Drafting and reserve budgets exceed total");
	if (s.chapterCount < 1 || s.targetWords < 100)
		errors.push("Chapter count and target words are invalid");
	for (const model of [s.planner, s.writer, s.auditor, s.editor]) {
		const price = s.pricing[model];
		if (!model || !price || price.input <= 0 || price.output <= 0)
			errors.push(
				`Pricing is not configured for ${model || "a selected model"}`,
			);
	}
	if (s.fallbackModel) {
		const price = s.pricing[s.fallbackModel];
		if (!price || price.input <= 0 || price.output <= 0)
			errors.push("Pricing is not configured for the fallback model");
	}
	return errors;
}

function project(bookId: string): ProjectRow | null {
	return (
		(db
			.prepare(
				"SELECT book_id, brief, settings, status FROM projects WHERE book_id = ?",
			)
			.get(bookId) as ProjectRow | undefined) ?? null
	);
}
function addLog(bookId: string, message: string) {
	db.prepare(
		"INSERT INTO logs (id, book_id, message, created_at) VALUES (?, ?, ?, ?)",
	).run(randomUUID(), bookId, message, now());
}
function setStatus(bookId: string, status: RunStatus) {
	db.prepare(
		"UPDATE projects SET status = ?, updated_at = ? WHERE book_id = ?",
	).run(status, now(), bookId);
}
function money(bookId: string) {
	return db
		.prepare(
			"SELECT COALESCE(SUM(CASE WHEN uncertain=0 THEN cost_usd ELSE 0 END),0) spent, COALESCE(SUM(reserved_usd),0) reserved, COALESCE(SUM(CASE WHEN uncertain=1 THEN cost_usd ELSE 0 END),0) uncertain FROM usage WHERE book_id = ?",
		)
		.get(bookId) as { spent: number; reserved: number; uncertain: number };
}

export function getNovella(bookId: string): NovellaView | null {
	const p = project(bookId);
	if (!p) return null;
	const settings = parse<Settings>(p.settings);
	const tasks = db
		.prepare(
			"SELECT id,type,chapter_number AS chapter,status,model,attempts,cost_usd AS cost,reserved_usd AS reservedUsd,error,deps,result,envelope FROM tasks WHERE book_id = ? ORDER BY rowid",
		)
		.all(bookId) as unknown as TaskRow[];
	const chapters = db
		.prepare(
			"SELECT number,title,content,revised FROM chapters WHERE book_id = ? ORDER BY number",
		)
		.all(bookId) as unknown as Array<{
		number: number;
		title: string;
		content: string;
		revised: number;
	}>;
	const issues = db
		.prepare(
			"SELECT id,severity,chapter_number AS chapter,evidence,fix FROM issues WHERE book_id = ? ORDER BY rowid",
		)
		.all(bookId) as unknown as IssueView[];
	const logs = db
		.prepare(
			"SELECT id,message,created_at AS createdAt FROM logs WHERE book_id = ? ORDER BY rowid",
		)
		.all(bookId) as Array<{ id: string; message: string; createdAt: string }>;
	const cost = money(bookId);
	const total = settings.totalUsd;
	const draftingSpent = db
		.prepare(
			"SELECT COALESCE(SUM(u.cost_usd),0) value FROM usage u JOIN tasks t ON t.id=u.task_id WHERE u.book_id=? AND t.envelope='drafting'",
		)
		.get(bookId) as { value: number };
	const reserveSpent = db
		.prepare(
			"SELECT COALESCE(SUM(u.cost_usd),0) value FROM usage u JOIN tasks t ON t.id=u.task_id WHERE u.book_id=? AND t.envelope='reserve'",
		)
		.get(bookId) as { value: number };
	const done = tasks.filter((t) => t.status === "completed").length;
	return {
		bookId,
		brief: parse<Brief>(p.brief),
		settings,
		status: p.status,
		budget: {
			total,
			spent: cost.spent,
			reserved: cost.reserved,
			uncertain: cost.uncertain,
			draftingRemaining: Math.max(
				0,
				settings.draftingUsd - draftingSpent.value,
			),
			reserveRemaining: Math.max(0, settings.reserveUsd - reserveSpent.value),
			totalRemaining: Math.max(
				0,
				total - cost.spent - cost.reserved - cost.uncertain,
			),
		},
		usage: {
			requests: (
				db
					.prepare("SELECT COUNT(*) n FROM usage WHERE book_id=?")
					.get(bookId) as { n: number }
			).n,
			inputTokens: (
				db
					.prepare(
						"SELECT COALESCE(SUM(input_tokens),0) n FROM usage WHERE book_id=?",
					)
					.get(bookId) as { n: number }
			).n,
			outputTokens: (
				db
					.prepare(
						"SELECT COALESCE(SUM(output_tokens),0) n FROM usage WHERE book_id=?",
					)
					.get(bookId) as { n: number }
			).n,
		},
		progress: { done, total: tasks.length },
		tasks: tasks.map((t) => ({
			...t,
			chapterNumber: t.chapter,
			costUsd: t.cost,
		})),
		chapters: chapters.map((c) => ({
			...c,
			wordCount: c.content.trim() ? c.content.trim().split(/\s+/).length : 0,
			revised: Boolean(c.revised),
		})),
		issues,
		logs,
	};
}

export function saveBrief(
	bookId: string,
	brief: Brief,
	settings: Settings,
): NovellaView {
	const errors = validateSettings(settings);
	if (errors.length) throw new Error(errors.join("; "));
	if (!getBook(bookId)) throw new Error("Book not found");
	const existing = project(bookId);
	if (!existing) {
		db.prepare(
			"INSERT INTO projects (book_id,brief,settings,status,updated_at) VALUES (?,?,?,?,?)",
		).run(bookId, json(brief), json(settings), "idle", now());
	} else {
		if (existing.status === "running")
			throw new Error("Cannot edit a running novella");
		db.prepare(
			"UPDATE projects SET brief=?, settings=?, updated_at=? WHERE book_id=?",
		).run(json(brief), json(settings), now(), bookId);
	}
	addLog(bookId, "Brief and settings saved");
	return invariant(getNovella(bookId), "Novella not found after saving");
}

function makeTasks(bookId: string, s: Settings) {
	db.prepare("DELETE FROM tasks WHERE book_id=?").run(bookId);
	const add = (
		type: string,
		model: string,
		deps: string[],
		chapter: number | null,
		envelope: "drafting" | "reserve",
	) => {
		const id = `${bookId}:${type}${chapter == null ? "" : `:${chapter}`}`;
		db.prepare(
			"INSERT INTO tasks (id,book_id,type,chapter_number,deps,status,model,envelope) VALUES (?,?,?,?,?,?,?,?)",
		).run(id, bookId, type, chapter, json(deps), "queued", model, envelope);
		return id;
	};
	const planner = add("planner", s.planner, [], null, "drafting");
	const bible = add("bible", s.writer, [planner], null, "drafting");
	const outline = add("outline", s.writer, [planner], null, "drafting");
	const writers = Array.from({ length: s.chapterCount }, (_, i) =>
		add("writer", s.writer, [bible, outline], i + 1, "drafting"),
	);
	const auditor = add("auditor", s.auditor, writers, null, "reserve");
	add("editor", s.editor, [auditor], null, "reserve");
}

export async function startRun(bookId: string): Promise<NovellaView> {
	const p = project(bookId);
	if (!p) throw new Error("Save a brief before starting");
	const s = parse<Settings>(p.settings);
	const errors = validateSettings(s);
	if (errors.length) throw new Error(errors.join("; "));
	if (p.status === "running")
		return invariant(getNovella(bookId), "Novella not found while running");
	const existingTasks = db
		.prepare("SELECT COUNT(*) n FROM tasks WHERE book_id=?")
		.get(bookId) as { n: number };
	if (p.status === "completed" && existingTasks.n)
		return invariant(getNovella(bookId), "Novella not found after completion");
	const apiKey = await getEffectiveGroqCredential();
	if (!apiKey)
		throw new GroqError("No Groq API key is configured", null, false, null);
	if (!existingTasks.n) makeTasks(bookId, s);
	setStatus(bookId, "running");
	const state = active.get(bookId) ?? {
		running: 0,
		models: new Map(),
		paused: false,
	};
	state.paused = false;
	active.set(bookId, state);
	addLog(bookId, "Run started");
	void pump(bookId, apiKey);
	return invariant(getNovella(bookId), "Novella not found after starting");
}

export function pauseRun(bookId: string): NovellaView {
	const p = project(bookId);
	if (!p) throw new Error("Novella not found");
	const state = active.get(bookId);
	if (state) state.paused = true;
	setStatus(bookId, "paused");
	addLog(bookId, "Run paused; in-flight requests will finish");
	return invariant(getNovella(bookId), "Novella not found after pausing");
}

export function resetRun(bookId: string): NovellaView {
	if (!project(bookId)) throw new Error("Novella not found");
	const state = active.get(bookId);
	if (state?.running) throw new Error("Pause the run before resetting");
	db.prepare("DELETE FROM tasks WHERE book_id=?").run(bookId);
	db.prepare("DELETE FROM chapters WHERE book_id=?").run(bookId);
	db.prepare("DELETE FROM issues WHERE book_id=?").run(bookId);
	db.prepare("DELETE FROM usage WHERE book_id=?").run(bookId);
	setStatus(bookId, "idle");
	addLog(bookId, "Run reset");
	return invariant(getNovella(bookId), "Novella not found after resetting");
}

export async function retryFailedRun(bookId: string): Promise<NovellaView> {
	const p = project(bookId);
	if (!p) throw new Error("Novella not found");
	if (p.status !== "failed") {
		return invariant(getNovella(bookId), "Novella not found while retrying");
	}
	db.prepare(
		"UPDATE tasks SET status='queued', error=NULL WHERE book_id=? AND status='failed'",
	).run(bookId);
	setStatus(bookId, "idle");
	addLog(bookId, "Failed tasks queued for retry");
	return startRun(bookId);
}

function estimate(task: TaskRow, s: Settings) {
	const price = invariant(
		s.pricing[task.model],
		`Pricing is not configured for ${task.model}`,
	);
	const maxOut =
		task.type === "writer"
			? Math.max(2400, Math.ceil((s.targetWords / s.chapterCount) * 2.5))
			: task.type === "auditor"
				? 1800
				: 2600;
	return {
		maxOut,
		usd: ((1600 * price.input + maxOut * price.output) / 1e6) * 1.2,
	};
}
function canReserve(
	bookId: string,
	task: TaskRow,
	amount: number,
	s: Settings,
) {
	const c = money(bookId);
	const envelopeSpent = db
		.prepare(
			"SELECT COALESCE(SUM(u.cost_usd + u.reserved_usd),0) value FROM usage u JOIN tasks t ON t.id=u.task_id WHERE u.book_id=? AND t.envelope=?",
		)
		.get(bookId, task.envelope) as { value: number };
	const limit = task.envelope === "drafting" ? s.draftingUsd : s.reserveUsd;
	return (
		Number.isFinite(amount) &&
		amount > 0 &&
		c.spent + c.reserved + c.uncertain + amount <= s.totalUsd &&
		envelopeSpent.value + amount <= limit
	);
}
function bounded(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}
function dependencyContext(bookId: string, task: TaskRow): string {
	const seen = new Set<string>();
	const chunks: string[] = [];
	let size = 0;
	const visit = (ids: string[]) => {
		for (const id of ids) {
			if (seen.has(id) || size >= 24000) continue;
			seen.add(id);
			const row = db
				.prepare(
					"SELECT type,status,result,deps FROM tasks WHERE id=? AND book_id=?",
				)
				.get(id, bookId) as
				| {
						type: string;
						status: TaskStatus;
						result: string | null;
						deps: string;
				  }
				| undefined;
			if (!row || row.status !== "completed") continue;
			let result = row.result ?? "";
			try {
				result = JSON.stringify(JSON.parse(result));
			} catch {
				result = "";
			}
			const part = `${row.type}: ${bounded(result, 7000)}`;
			chunks.push(part);
			size += part.length;
			visit(parse<string[]>(row.deps));
		}
	};
	visit(parse<string[]>(task.deps));
	return bounded(chunks.join("\n"), 24000);
}
function taskPrompt(
	bookId: string,
	task: TaskRow,
): { system: string; user: string; json: boolean } {
	const p = invariant(
		project(bookId),
		"Novella not found while creating prompt",
	);
	const brief = parse<Brief>(p.brief);
	const chapters = (
		db
			.prepare(
				"SELECT number,title,content FROM chapters WHERE book_id=? ORDER BY number",
			)
			.all(bookId) as Array<{ number: number; title: string; content: string }>
	).map((chapter) => ({ ...chapter, content: bounded(chapter.content, 2500) }));
	const context = `Brief: ${bounded(JSON.stringify(brief), 8000)}\nCompleted dependency results:\n${dependencyContext(bookId, task)}\nExisting chapters: ${bounded(JSON.stringify(chapters), 12000)}`;
	if (task.type === "writer")
		return {
			system:
				"Write polished original fiction. Return JSON with title and content.",
			user: `${context}\nWrite chapter ${task.chapter} with a strong arc.`,
			json: true,
		};
	if (task.type === "auditor")
		return {
			system: "Audit fiction continuity. Return JSON with issues array.",
			user: `${context}\nFind concrete continuity and plot issues.`,
			json: true,
		};
	if (task.type === "editor")
		return {
			system: "Edit only where needed. Return JSON with chapters array.",
			user: `${context}\nApply targeted fixes for any issues.`,
			json: true,
		};
	return {
		system: "Plan a coherent novella. Return useful JSON.",
		user: `${context}\nProduce the ${task.type} for the other agents.`,
		json: true,
	};
}

async function execute(
	bookId: string,
	task: TaskRow,
	s: Settings,
	apiKey: string,
) {
	let model = task.model;
	let fallbackUsed = false;
	for (let attempt = 1; attempt <= s.retryMax + 1; attempt++) {
		const e = estimate({ ...task, model }, s);
		if (!canReserve(bookId, task, e.usd, s))
			throw new Error("budget_exhausted");
		db.prepare(
			"UPDATE tasks SET status=?, attempts=?, model=?, reserved_usd=? WHERE id=?",
		).run("running", attempt, model, e.usd, task.id);
		db.prepare(
			"INSERT INTO usage (id,task_id,book_id,attempt,model,reserved_usd,created_at) VALUES (?,?,?,?,?,?,?)",
		).run(randomUUID(), task.id, bookId, attempt, model, e.usd, now());
		try {
			const result = await chatOnce({
				model,
				...taskPrompt(bookId, task),
				temperature: task.type === "auditor" ? 0.2 : 0.6,
				maxTokens: e.maxOut,
				apiKey,
			});
			const price = invariant(
				s.pricing[model],
				`Pricing is not configured for ${model}`,
			);
			const cost =
				(result.inputTokens * price.input +
					result.outputTokens * price.output) /
				1e6;
			const parsed = (() => {
				try {
					return JSON.parse(result.content) as Record<string, unknown>;
				} catch {
					const suffix =
						result.finishReason === "length"
							? " (response was truncated at the completion limit)"
							: "";
					throw new GroqError(
						`Invalid JSON response${suffix}`,
						null,
						true,
						null,
					);
				}
			})();
			db.prepare(
				"UPDATE usage SET input_tokens=?,output_tokens=?,cost_usd=?,reserved_usd=0 WHERE task_id=? AND attempt=?",
			).run(result.inputTokens, result.outputTokens, cost, task.id, attempt);
			db.prepare(
				"UPDATE tasks SET status=?,cost_usd=?,reserved_usd=0,result=?,error=NULL WHERE id=?",
			).run("completed", cost, json(parsed), task.id);
			applyResult(bookId, task, parsed);
			return;
		} catch (error) {
			const retryable = error instanceof GroqError ? error.retryable : false;
			const wait =
				error instanceof GroqError
					? (error.retryAfterMs ?? Math.min(30000, 500 * 2 ** (attempt - 1)))
					: 0;
			const message = error instanceof Error ? error.message : String(error);
			if (
				!retryable &&
				s.fallbackModel &&
				!fallbackUsed &&
				model !== s.fallbackModel
			) {
				db.prepare(
					"UPDATE usage SET uncertain=1,cost_usd=reserved_usd,reserved_usd=0,error=? WHERE task_id=? AND attempt=?",
				).run(message, task.id, attempt);
				model = s.fallbackModel;
				fallbackUsed = true;
				continue;
			}
			if (retryable && attempt <= s.retryMax) {
				db.prepare(
					"UPDATE usage SET uncertain=1,cost_usd=reserved_usd,reserved_usd=0,error=? WHERE task_id=? AND attempt=?",
				).run(message, task.id, attempt);
				await new Promise((resolve) => setTimeout(resolve, wait));
				continue;
			}
			db.prepare(
				"UPDATE usage SET uncertain=1,cost_usd=reserved_usd,reserved_usd=0,error=? WHERE task_id=? AND attempt=?",
			).run(message, task.id, attempt);
			db.prepare(
				"UPDATE tasks SET status=?,reserved_usd=0,error=? WHERE id=?",
			).run("failed", message, task.id);
			throw error;
		}
	}
}

function applyResult(
	bookId: string,
	task: TaskRow,
	result: Record<string, unknown>,
) {
	if (task.type === "writer") {
		const content =
			typeof result.content === "string"
				? result.content
				: typeof result.text === "string"
					? result.text
					: "";
		const title =
			typeof result.title === "string"
				? result.title
				: `Chapter ${task.chapter}`;
		db.prepare(
			"INSERT INTO chapters (book_id,number,title,content) VALUES (?,?,?,?) ON CONFLICT(book_id,number) DO UPDATE SET title=excluded.title,content=excluded.content",
		).run(bookId, task.chapter ?? null, title, content);
	} else if (task.type === "auditor") {
		db.prepare("DELETE FROM issues WHERE book_id=?").run(bookId);
		for (const issue of Array.isArray(result.issues) ? result.issues : []) {
			const i = issue as Record<string, unknown>;
			db.prepare(
				"INSERT INTO issues (id,book_id,severity,chapter_number,evidence,fix) VALUES (?,?,?,?,?,?)",
			).run(
				randomUUID(),
				bookId,
				String(i.severity ?? "medium"),
				typeof i.chapter === "number" ? i.chapter : null,
				String(i.evidence ?? ""),
				i.fix == null ? null : String(i.fix),
			);
		}
		const settings = parse<Settings>(
			invariant(project(bookId), "Novella not found while applying result")
				.settings,
		);
		const issueCount = (
			db
				.prepare("SELECT COUNT(*) n FROM issues WHERE book_id=?")
				.get(bookId) as { n: number }
		).n;
		if (settings.reviseRounds < 1 || issueCount === 0) {
			db.prepare(
				"UPDATE tasks SET status='completed', result=? WHERE book_id=? AND type='editor'",
			).run(json({ skipped: true }), bookId);
		}
	} else if (task.type === "editor") {
		for (const chapter of Array.isArray(result.chapters)
			? result.chapters
			: []) {
			const c = chapter as Record<string, unknown>;
			if (typeof c.number === "number" && typeof c.content === "string")
				db.prepare(
					"UPDATE chapters SET content=?,revised=1 WHERE book_id=? AND number=?",
				).run(c.content, bookId, c.number);
		}
	}
}

async function pump(bookId: string, apiKey: string): Promise<void> {
	const p = project(bookId);
	if (!p || p.status !== "running") return;
	const s = parse<Settings>(p.settings);
	const state = active.get(bookId) ?? {
		running: 0,
		models: new Map(),
		paused: false,
	};
	active.set(bookId, state);
	while (!state.paused && state.running < s.maxConcurrent) {
		const rows = db
			.prepare(
				"SELECT id,book_id,type,chapter_number AS chapter,status,model,attempts,cost_usd AS cost,reserved_usd AS reservedUsd,error,deps,result,envelope FROM tasks WHERE book_id=? AND status='queued' ORDER BY rowid",
			)
			.all(bookId) as unknown as TaskRow[];
		const task = rows.find((t) =>
			parse<string[]>(t.deps).every(
				(id) =>
					(
						db.prepare("SELECT status FROM tasks WHERE id=?").get(id) as
							| { status?: string }
							| undefined
					)?.status === "completed",
			),
		);
		if (!task) {
			const unfinished = db
				.prepare(
					"SELECT COUNT(*) n FROM tasks WHERE book_id=? AND status NOT IN ('completed','failed')",
				)
				.get(bookId) as { n: number };
			const failed = db
				.prepare(
					"SELECT COUNT(*) n FROM tasks WHERE book_id=? AND status='failed'",
				)
				.get(bookId) as { n: number };
			if (!unfinished.n) {
				setStatus(bookId, failed.n ? "failed" : "completed");
				addLog(bookId, failed.n ? "Run failed" : "Run completed");
			}
			break;
		}
		const count = state.models.get(task.model) ?? 0;
		if (count >= s.perModelConcurrency) break;
		state.running++;
		state.models.set(task.model, count + 1);
		void execute(bookId, task, s, apiKey)
			.then(() => {
				state.running--;
				state.models.set(task.model, (state.models.get(task.model) ?? 1) - 1);
				void pump(bookId, apiKey);
			})
			.catch((error: unknown) => {
				state.running--;
				state.models.set(
					task.model,
					Math.max(0, (state.models.get(task.model) ?? 1) - 1),
				);
				if (error instanceof Error && error.message === "budget_exhausted") {
					setStatus(bookId, "budget_exhausted");
					state.paused = true;
					addLog(bookId, "Budget reservation denied");
				} else {
					setStatus(bookId, "failed");
					addLog(
						bookId,
						`Task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (!state.paused) void pump(bookId, apiKey);
			});
	}
}

export function resumeInterruptedRuns(): void {
	const rows = db
		.prepare("SELECT book_id FROM projects WHERE status='running'")
		.all() as Array<{ book_id: string }>;
	for (const row of rows) {
		db.prepare(
			"UPDATE usage SET uncertain=1, cost_usd=reserved_usd, reserved_usd=0, error='Interrupted by server restart' WHERE book_id=? AND task_id IN (SELECT id FROM tasks WHERE book_id=? AND status='running')",
		).run(row.book_id, row.book_id);
		db.prepare(
			"UPDATE tasks SET status='queued', reserved_usd=0 WHERE book_id=? AND status='running'",
		).run(row.book_id);
		setStatus(row.book_id, "paused");
		addLog(
			row.book_id,
			"Recovered after restart; in-flight reservations marked uncertain",
		);
	}
}

resumeInterruptedRuns();
