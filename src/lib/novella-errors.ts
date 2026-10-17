export type PublicError = {
	name: string;
	code: string;
	message: string;
	correlationId: string;
	retryable: boolean;
};

export type StructuredErrorOptions = {
	code?: string;
	message?: string;
	correlationId?: string;
	retryable?: boolean;
	cause?: unknown;
};

const SECRET_KEY = /(authorization|api[-_]?key|cookie|password|secret|token)/i;
const SECRET_VALUE =
	/(bearer\s+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi;

export function createCorrelationId(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
	const bytes = new Uint8Array(16);
	cryptoApi?.getRandomValues(bytes);
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function redactSecrets(value: unknown): unknown {
	if (typeof value === "string")
		return value.replace(SECRET_VALUE, "$1[REDACTED]");
	if (Array.isArray(value)) return value.map(redactSecrets);
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			result[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(item);
		}
		return result;
	}
	return value;
}

export class NovellaError extends Error {
	readonly code: string;
	readonly correlationId: string;
	readonly retryable: boolean;

	constructor(options: StructuredErrorOptions = {}) {
		const message = options.message ?? "The novella operation failed";
		super(String(redactSecrets(message)));
		this.name = "NovellaError";
		this.code = options.code ?? "NOVELLA_ERROR";
		this.correlationId = options.correlationId ?? createCorrelationId();
		this.retryable = options.retryable ?? false;
	}
}

export function toPublicError(
	error: unknown,
	options: Pick<StructuredErrorOptions, "code" | "retryable"> = {},
): PublicError {
	if (error instanceof NovellaError) {
		return {
			name: error.name,
			code: error.code,
			message: error.message,
			correlationId: error.correlationId,
			retryable: error.retryable,
		};
	}
	const message =
		error instanceof Error ? error.message : "The novella operation failed";
	return {
		name: "NovellaError",
		code: options.code ?? "NOVELLA_ERROR",
		message: String(redactSecrets(message)),
		correlationId: createCorrelationId(),
		retryable: options.retryable ?? false,
	};
}

export function serializeError(error: unknown): PublicError {
	return toPublicError(error);
}
