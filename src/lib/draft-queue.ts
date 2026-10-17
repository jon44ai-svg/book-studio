export type DraftQueueStatus = "pending" | "inflight" | "failed";

export type DraftQueueItem<T> = {
	id: string;
	draft: T;
	createdAt: number;
	updatedAt: number;
	attempts: number;
	status: DraftQueueStatus;
	lastError?: string;
	leaseUntil?: number;
};

export type DraftQueue<T> = {
	enqueue(draft: T, id?: string): DraftQueueItem<T>;
	claim(now?: number): DraftQueueItem<T> | undefined;
	acknowledge(id: string): boolean;
	retry(id: string, error?: unknown, now?: number): boolean;
	remove(id: string): boolean;
	get(id: string): DraftQueueItem<T> | undefined;
	list(): DraftQueueItem<T>[];
};

export type DraftQueueOptions = {
	leaseMs?: number;
	maxAttempts?: number;
	now?: () => number;
};

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
		.join(",")}}`;
}

export function draftFingerprint<T>(draft: T): string {
	let hash = 2166136261;
	for (const character of stableJson(draft)) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createDraftQueue<T>(
	options: DraftQueueOptions = {},
): DraftQueue<T> {
	const leaseMs = Math.max(1, options.leaseMs ?? 30_000);
	const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
	const now = options.now ?? Date.now;
	const items = new Map<string, DraftQueueItem<T>>();

	function reclaimExpired(timestamp: number) {
		for (const item of items.values()) {
			if (
				item.status === "inflight" &&
				item.leaseUntil !== undefined &&
				item.leaseUntil <= timestamp
			) {
				item.status = item.attempts >= maxAttempts ? "failed" : "pending";
				item.updatedAt = timestamp;
				delete item.leaseUntil;
			}
		}
	}

	return {
		enqueue(draft, suppliedId) {
			const timestamp = now();
			const id = suppliedId ?? draftFingerprint(draft);
			const existing = items.get(id);
			if (existing) return { ...existing };
			const item: DraftQueueItem<T> = {
				id,
				draft,
				createdAt: timestamp,
				updatedAt: timestamp,
				attempts: 0,
				status: "pending",
			};
			items.set(id, item);
			return { ...item };
		},
		claim(timestamp = now()) {
			reclaimExpired(timestamp);
			const item = [...items.values()].find(
				(candidate) => candidate.status === "pending",
			);
			if (!item) return undefined;
			item.status = "inflight";
			item.attempts += 1;
			item.updatedAt = timestamp;
			item.leaseUntil = timestamp + leaseMs;
			return { ...item };
		},
		acknowledge(id) {
			return items.delete(id);
		},
		retry(id, error, timestamp = now()) {
			const item = items.get(id);
			if (!item || item.status !== "inflight") return false;
			item.updatedAt = timestamp;
			item.lastError =
				error instanceof Error
					? error.message
					: String(error ?? "Unknown error");
			delete item.leaseUntil;
			item.status = item.attempts >= maxAttempts ? "failed" : "pending";
			return true;
		},
		remove(id) {
			return items.delete(id);
		},
		get(id) {
			const item = items.get(id);
			return item ? { ...item } : undefined;
		},
		list() {
			return [...items.values()].map((item) => ({ ...item }));
		},
	};
}
