import type { RunStatus, TaskStatus, TaskView } from "#/lib/novella.server";

type GenerationProgressProps = {
	done: number;
	total: number;
	status: RunStatus;
	tasks: ReadonlyArray<Pick<TaskView, "type" | "status" | "chapterNumber">>;
};

const statusLabel: Record<TaskStatus, string> = {
	queued: "Queued",
	running: "Running",
	completed: "Completed",
	failed: "Failed",
	paused: "Paused",
};

export function GenerationProgress({
	done,
	total,
	status,
	tasks,
}: GenerationProgressProps) {
	const safeTotal = Math.max(0, total);
	const safeDone = Math.min(Math.max(0, done), safeTotal);
	const percentage = safeTotal ? Math.round((safeDone / safeTotal) * 100) : 0;
	const activeTask = tasks.find((task) => task.status === "running");
	const activeLabel = activeTask
		? `${activeTask.type}${activeTask.chapterNumber == null ? "" : `, chapter ${activeTask.chapterNumber}`}`
		: null;

	return (
		<section
			aria-labelledby="generation-progress-heading"
			className="rounded-xl border border-border p-4"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3
					className="text-xs font-semibold text-muted-foreground uppercase"
					id="generation-progress-heading"
				>
					Generation progress
				</h3>
				<span aria-live="polite" className="text-sm font-medium">
					{safeDone} of {safeTotal} tasks ({percentage}%)
				</span>
			</div>
			<div
				aria-label={`Generation progress: ${safeDone} of ${safeTotal} tasks`}
				aria-valuemax={safeTotal}
				aria-valuemin={0}
				aria-valuenow={safeDone}
				className="mt-3 h-2 overflow-hidden rounded-full bg-border"
				role="progressbar"
			>
				<div
					className="h-full bg-primary transition-all"
					style={{ width: `${percentage}%` }}
				/>
			</div>
			<p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
				{activeLabel
					? `Currently working on ${activeLabel}.`
					: `Generation is ${status.replace("_", " ")}.`}
			</p>
			<ul className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
				{(["queued", "running", "completed", "failed"] as const).map(
					(taskStatus) => (
						<li className="rounded-lg bg-background p-2" key={taskStatus}>
							<span className="block text-muted-foreground">
								{statusLabel[taskStatus]}
							</span>
							<strong>
								{tasks.filter((task) => task.status === taskStatus).length}
							</strong>
						</li>
					),
				)}
			</ul>
		</section>
	);
}
