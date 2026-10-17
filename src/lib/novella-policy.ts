export type ModelLimits = {
	contextTokens?: number;
	outputTokens?: number;
	inputTokensPerMinute?: number;
	outputTokensPerMinute?: number;
	requestsPerMinute?: number;
};

export type ModelPolicy = {
	id: string;
	inputPricePerMillion: number;
	outputPricePerMillion: number;
	limits?: ModelLimits;
	limitsVerified?: boolean;
};

export type SettingsPolicy = {
	planner?: string;
	writer?: string;
	auditor?: string;
	editor?: string;
	fallbackModel?: string;
	pricing?: Record<string, { input: number; output: number }>;
	modelPolicies?: Record<string, ModelPolicy>;
	totalUsd?: number;
	draftingUsd?: number;
	reserveUsd?: number;
	chapterCount?: number;
	targetWords?: number;
	reviseRounds?: number;
	maxConcurrent?: number;
	perModelConcurrency?: number;
	retryMax?: number;
};

export type PolicyIssueCode =
	| "invalid-number"
	| "invalid-budget"
	| "invalid-range"
	| "missing-model"
	| "missing-price"
	| "unverified-limits";

export type PolicyIssue = {
	code: PolicyIssueCode;
	field: string;
	message: string;
};

const roles = ["planner", "writer", "auditor", "editor"] as const;
const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

function addNumberIssue(
	issues: PolicyIssue[],
	settings: SettingsPolicy,
	field: keyof SettingsPolicy,
) {
	const value = settings[field];
	if (value !== undefined && !finite(value)) {
		issues.push({
			code: "invalid-number",
			field,
			message: `${field} must be a finite number`,
		});
	}
}

/**
 * Validates the model and run policy before a request can be dispatched.
 * A positive price is intentional: zero means "unknown", not "free".
 */
export function validateSettingsPolicy(
	settings: SettingsPolicy,
): PolicyIssue[] {
	const issues: PolicyIssue[] = [];
	for (const field of [
		"totalUsd",
		"draftingUsd",
		"reserveUsd",
		"chapterCount",
		"targetWords",
		"reviseRounds",
		"maxConcurrent",
		"perModelConcurrency",
		"retryMax",
	] as const) {
		addNumberIssue(issues, settings, field);
	}

	const budgets = ["totalUsd", "draftingUsd", "reserveUsd"] as const;
	for (const field of budgets) {
		const value = settings[field];
		if (finite(value) && value < 0)
			issues.push({
				code: "invalid-budget",
				field,
				message: `${field} cannot be negative`,
			});
	}
	if (
		finite(settings.draftingUsd) &&
		finite(settings.reserveUsd) &&
		finite(settings.totalUsd) &&
		settings.draftingUsd + settings.reserveUsd > settings.totalUsd
	) {
		issues.push({
			code: "invalid-budget",
			field: "draftingUsd",
			message: "draftingUsd and reserveUsd cannot exceed totalUsd",
		});
	}

	const ranges: Array<[keyof SettingsPolicy, number, number]> = [
		["chapterCount", 1, Number.MAX_SAFE_INTEGER],
		["targetWords", 100, Number.MAX_SAFE_INTEGER],
		["reviseRounds", 0, 1],
		["maxConcurrent", 1, Number.MAX_SAFE_INTEGER],
		["perModelConcurrency", 1, Number.MAX_SAFE_INTEGER],
		["retryMax", 0, 10],
	];
	for (const [field, minimum, maximum] of ranges) {
		const value = settings[field];
		if (
			finite(value) &&
			(!Number.isInteger(value) || value < minimum || value > maximum)
		)
			issues.push({
				code: "invalid-range",
				field,
				message: `${field} must be an integer from ${minimum} to ${maximum}`,
			});
	}

	const selected = roles.map((role) => settings[role]);
	if (settings.fallbackModel) selected.push(settings.fallbackModel);
	for (const model of selected) {
		if (!model?.trim()) {
			issues.push({
				code: "missing-model",
				field: "model",
				message: "Every selected model must have an ID",
			});
			continue;
		}
		const configured = settings.pricing?.[model];
		const policy = settings.modelPolicies?.[model];
		const input = policy?.inputPricePerMillion ?? configured?.input;
		const output = policy?.outputPricePerMillion ?? configured?.output;
		if (!finite(input) || !finite(output) || input <= 0 || output <= 0) {
			issues.push({
				code: "missing-price",
				field: `pricing.${model}`,
				message: `Positive input and output prices are required for ${model}`,
			});
		}
		if (policy && (policy.limitsVerified !== true || !policy.limits)) {
			issues.push({
				code: "unverified-limits",
				field: `modelPolicies.${model}.limits`,
				message: `Verified limits or explicit user-supplied limits are required for ${model}`,
			});
		}
	}
	return issues;
}

export function assertSettingsPolicy(settings: SettingsPolicy): void {
	const issues = validateSettingsPolicy(settings);
	if (issues.length) {
		throw new Error(issues.map((issue) => issue.message).join("; "));
	}
}

export const validateModelPolicy = validateSettingsPolicy;
