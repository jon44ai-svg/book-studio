import { describe, expect, it } from "vitest";
import { createDraftQueue } from "./draft-queue";
import { NovellaError, redactSecrets, toPublicError } from "./novella-errors";
import { validateSettingsPolicy } from "./novella-policy";

const validSettings = {
	planner: "writer",
	writer: "writer",
	auditor: "editor",
	editor: "editor",
	fallbackModel: "",
	pricing: {
		writer: { input: 1, output: 2 },
		editor: { input: 1, output: 2 },
	},
	totalUsd: 2,
	draftingUsd: 1.3,
	reserveUsd: 0.7,
	chapterCount: 4,
	targetWords: 400,
	reviseRounds: 0,
	maxConcurrent: 2,
	perModelConcurrency: 1,
	retryMax: 2,
};

describe("novella safeguards", () => {
	it("rejects unknown prices and invalid budget ranges", () => {
		const issues = validateSettingsPolicy({
			...validSettings,
			pricing: {
				writer: { input: 0, output: 2 },
				editor: { input: 1, output: 2 },
			},
			draftingUsd: 2,
		});
		expect(issues.map((issue) => issue.code)).toContain("missing-price");
		expect(issues.map((issue) => issue.code)).toContain("invalid-budget");
	});

	it("redacts secrets and keeps a stable public correlation ID", () => {
		expect(
			redactSecrets({ apiKey: "secret", message: "Bearer abc123" }),
		).toEqual({
			apiKey: "[REDACTED]",
			message: "Bearer [REDACTED]",
		});
		const error = new NovellaError({
			code: "UPSTREAM",
			message: "token=secret",
			correlationId: "corr-1",
			retryable: true,
		});
		expect(toPublicError(error)).toEqual({
			name: "NovellaError",
			code: "UPSTREAM",
			message: "token=[REDACTED]",
			correlationId: "corr-1",
			retryable: true,
		});
	});

	it("deduplicates drafts and reclaims expired leases", () => {
		let timestamp = 100;
		const queue = createDraftQueue({ leaseMs: 10, now: () => timestamp });
		const first = queue.enqueue({ title: "Draft" });
		expect(queue.enqueue({ title: "Draft" }).id).toBe(first.id);
		expect(queue.claim()?.status).toBe("inflight");
		timestamp = 111;
		expect(queue.claim()?.id).toBe(first.id);
		expect(queue.acknowledge(first.id)).toBe(true);
		expect(queue.list()).toHaveLength(0);
	});
});
