import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Type-only imports are erased, so the server module never reaches the client bundle.
import type { NovellaView } from "#/lib/novella.server";

const bookId = z.string().min(1).max(100);
const text = (max: number) => z.string().max(max);
const num = z.number().finite();
const int = (min: number, max: number) => z.number().int().min(min).max(max);

const briefSchema = z.object({
	title: text(200),
	genre: text(120),
	tone: text(200),
	pov: text(120),
	tense: text(120),
	premise: text(4000),
	characters: text(4000),
	setting: text(2000),
	ending: text(2000),
	plotPoints: text(4000),
});

const settingsSchema = z
	.object({
		planner: text(200),
		writer: text(200),
		auditor: text(200),
		editor: text(200),
		fallbackModel: text(200).optional(),
		pricing: z.record(
			text(200),
			z.object({ input: num.min(0), output: num.min(0) }),
		),
		totalUsd: num.min(0),
		draftingUsd: num.min(0),
		reserveUsd: num.min(0),
		chapterCount: int(1, 200),
		targetWords: int(100, 200000),
		reviseRounds: int(0, 1),
		maxConcurrent: int(1, 32),
		perModelConcurrency: int(1, 32),
		retryMax: int(0, 10),
	})
	.superRefine((settings, context) => {
		if (settings.draftingUsd + settings.reserveUsd > settings.totalUsd) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Drafting and reserve budgets exceed total",
				path: ["totalUsd"],
			});
		}

		for (const model of [
			settings.planner,
			settings.writer,
			settings.auditor,
			settings.editor,
		]) {
			const price = settings.pricing[model];
			if (!model || !price || price.input <= 0 || price.output <= 0) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Pricing is not configured for ${model || "a selected model"}`,
					path: ["pricing", model],
				});
			}
		}

		if (settings.fallbackModel) {
			const price = settings.pricing[settings.fallbackModel];
			if (!price || price.input <= 0 || price.output <= 0) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Pricing is not configured for the fallback model",
					path: ["pricing", settings.fallbackModel],
				});
			}
		}
	});

export const getBookFn = createServerFn({ method: "GET" })
	.validator(z.string())
	.handler(async ({ data: id }) => {
		const { getBook } = await import("#/lib/books.server");
		return getBook(id);
	});

export const getNovellaFn = createServerFn({ method: "GET" })
	.validator(bookId)
	.handler(async ({ data: id }): Promise<NovellaView | null> => {
		const { getNovella } = await import("#/lib/novella.server");
		return getNovella(id);
	});

export const getDefaultSettingsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { defaultSettings } = await import("#/lib/novella.server");
		return defaultSettings();
	},
);

export const getGroqStatusFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { hasGroqKey } = await import("#/lib/groq.server");
		const { getUserGroqCredential, hasCredentialStorage } = await import(
			"#/lib/groq-credentials.server"
		);
		const personalKey = await getUserGroqCredential().catch(() => null);
		return {
			hasKey: Boolean(personalKey) || hasGroqKey(),
			hasDeploymentKey: hasGroqKey(),
			hasPersonalKey: Boolean(personalKey),
			canSavePersonalKey: hasCredentialStorage(),
		};
	},
);

export const saveGroqCredentialFn = createServerFn({ method: "POST" })
	.validator(z.string().min(1).max(500))
	.handler(async ({ data }) => {
		const { saveUserGroqCredential } = await import(
			"#/lib/groq-credentials.server"
		);
		await saveUserGroqCredential(data);
		return { saved: true };
	});

export const deleteGroqCredentialFn = createServerFn({
	method: "POST",
}).handler(async () => {
	const { deleteUserGroqCredential } = await import(
		"#/lib/groq-credentials.server"
	);
	await deleteUserGroqCredential();
	return { deleted: true };
});

export const getGroqModelsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getEffectiveGroqCredential } = await import(
			"#/lib/groq-credentials.server"
		);
		const { listModels } = await import("#/lib/groq.server");
		const key = await getEffectiveGroqCredential();
		if (!key) return { models: [] };
		return { models: await listModels(key) };
	},
);

export const saveBriefFn = createServerFn({ method: "POST" })
	.validator(z.object({ bookId, brief: briefSchema, settings: settingsSchema }))
	.handler(async ({ data }): Promise<NovellaView> => {
		const { saveBrief } = await import("#/lib/novella.server");
		return saveBrief(data.bookId, data.brief, data.settings);
	});

export const startRunFn = createServerFn({ method: "POST" })
	.validator(bookId)
	.handler(async ({ data: id }): Promise<NovellaView> => {
		const { startRun } = await import("#/lib/novella.server");
		return startRun(id);
	});

export const pauseRunFn = createServerFn({ method: "POST" })
	.validator(bookId)
	.handler(async ({ data: id }): Promise<NovellaView> => {
		const { pauseRun } = await import("#/lib/novella.server");
		return pauseRun(id);
	});

export const resetRunFn = createServerFn({ method: "POST" })
	.validator(bookId)
	.handler(async ({ data: id }): Promise<NovellaView> => {
		const { resetRun } = await import("#/lib/novella.server");
		return resetRun(id);
	});

export const retryFailedRunFn = createServerFn({ method: "POST" })
	.validator(bookId)
	.handler(async ({ data: id }): Promise<NovellaView> => {
		const { retryFailedRun } = await import("#/lib/novella.server");
		return retryFailedRun(id);
	});
