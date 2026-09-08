"use client";

import type { ItemDetailRoute } from "@/lib/navigation/item-routes";
import Link from "next/link";
import type { Event, Job } from "@/types";
import { formatDate, parseDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CompletionPill } from "@/components/opportunities/completion-pill";

type DeadlineRow =
  | {
      key: string;
      itemKind: "job";
      item: Job;
      title: string;
      deadline: string;
      deadlineMs: number;
      daysLeft: number;
      kindLabel: "Job application";
      actionLabel: "Applied";
      done: boolean;
    }
  | {
      key: string;
      itemKind: "event";
      item: Event;
      title: string;
      deadline: string;
      deadlineMs: number;
      daysLeft: number;
      kindLabel: "Event registration" | "Event submission";
      actionLabel: "Registered" | "Submitted";
      done: boolean;
    };

function calendarOrdinal(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function deadlineDetails(
  deadline: string | undefined,
  now: Date,
): { deadline: string; deadlineMs: number; daysLeft: number } | undefined {
  const parsed = parseDate(deadline);
  if (!deadline || !parsed) return undefined;
  return {
    deadline,
    deadlineMs: parsed.getTime(),
    daysLeft: Math.round(
      (calendarOrdinal(parsed) - calendarOrdinal(now)) / 86_400_000,
    ),
  };
}

export function buildDeadlineRows({
  savedJobs,
  savedEvents,
  appliedAt,
  registeredAt,
  submittedAt,
  nowMs,
}: {
  savedJobs: Job[];
  savedEvents: Event[];
  appliedAt: Record<string, string>;
  registeredAt: Record<string, string>;
  submittedAt: Record<string, string>;
  nowMs: number;
}): DeadlineRow[] {
  const now = new Date(nowMs);
  const rows: DeadlineRow[] = [];

  for (const job of savedJobs) {
    const details = deadlineDetails(job.applicationDeadline, now);
    if (!details) continue;
    rows.push({
      key: `job:${job.id}:application`,
      itemKind: "job",
      item: job,
      title: job.roleTitle,
      ...details,
      kindLabel: "Job application",
      actionLabel: "Applied",
      done: Boolean(appliedAt[job.id]),
    });
  }

  for (const event of savedEvents) {
    const registration = deadlineDetails(event.registrationDeadline, now);
    if (registration) {
      rows.push({
        key: `event:${event.id}:registration`,
        itemKind: "event",
        item: event,
        title: event.name,
        ...registration,
        kindLabel: "Event registration",
        actionLabel: "Registered",
        done: Boolean(registeredAt[event.id]),
      });
    }
    const submission = deadlineDetails(event.deadline, now);
    if (submission) {
      rows.push({
        key: `event:${event.id}:submission`,
        itemKind: "event",
        item: event,
        title: event.name,
        ...submission,
        kindLabel: "Event submission",
        actionLabel: "Submitted",
        done: Boolean(submittedAt[event.id]),
      });
    }
  }

  return rows.sort(
    (left, right) =>
      Number(left.done) - Number(right.done) ||
      left.deadlineMs - right.deadlineMs ||
      left.key.localeCompare(right.key),
  );
}

function daysLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const overdue = Math.abs(daysLeft);
    return `${overdue} ${overdue === 1 ? "day" : "days"} overdue`;
  }
  if (daysLeft === 0) return "Due today";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}

function urgencyTone(row: DeadlineRow): {
  text: string;
  track: string;
  fill: string;
} {
  if (row.done) {
    return {
      text: "text-done",
      track: "bg-done-dim",
      fill: "bg-done",
    };
  }
  if (row.daysLeft <= 14) {
    return {
      text: "text-red",
      track: "bg-red/[0.06]",
      fill: "bg-red",
    };
  }
  if (row.daysLeft <= 30) {
    return {
      text: "text-accent",
      track: "bg-accent-dim",
      fill: "bg-accent",
    };
  }
  return {
    text: "text-text-muted",
    track: "bg-bg-secondary",
    fill: "bg-text-muted",
  };
}

function urgencyProgress(row: DeadlineRow): number {
  if (row.done || row.daysLeft <= 0) return 100;
  return Math.round(
    Math.max(8, Math.min(100, ((60 - row.daysLeft) / 60) * 100)),
  );
}

export function DeadlinesBoard({
  savedJobs,
  savedEvents,
  appliedAt,
  registeredAt,
  submittedAt,
  onJobApplied,
  onEventRegistered,
  onEventSubmitted,
  nowMs,
}: {
  savedJobs: Job[];
  savedEvents: Event[];
  appliedAt: Record<string, string>;
  registeredAt: Record<string, string>;
  submittedAt: Record<string, string>;
  onJobApplied: (job: Job, next: boolean) => void;
  onEventRegistered: (event: Event, next: boolean) => void;
  onEventSubmitted: (event: Event, next: boolean) => void;
  nowMs?: number;
}) {
  const rows =
    nowMs === undefined
      ? []
      : buildDeadlineRows({
          savedJobs,
          savedEvents,
          appliedAt,
          registeredAt,
          submittedAt,
          nowMs,
        });

  return (
    <section className="rounded-3xl bg-surface p-6 shadow-card" data-deadlines-board>
      <div>
        <p className="text-micro font-semibold uppercase tracking-[0.18em] text-text-faint">
          Time remaining
        </p>
        <h2 className="mt-1 text-title font-semibold text-heading">
          Deadlines
        </h2>
      </div>

      {rows.length === 0 ? (
        <p className="mt-5 text-body-sm text-text-muted">
          Saved jobs and events with deadlines will appear here.
        </p>
      ) : (
        <ol className="mt-5 space-y-2.5">
          {rows.map((row) => {
            const tone = urgencyTone(row);
            // ABC-freemium 9-05 — annotated, not cast, so both branches are
            // checked against the real route tree.
            const href: ItemDetailRoute =
              row.itemKind === "job"
                ? `/jobs/${row.item.id}`
                : `/events/${row.item.id}`;
            const onChange =
              row.itemKind === "job"
                ? (next: boolean) => onJobApplied(row.item, next)
                : row.actionLabel === "Registered"
                  ? (next: boolean) => onEventRegistered(row.item, next)
                  : (next: boolean) => onEventSubmitted(row.item, next);

            return (
              <li
                key={row.key}
                data-deadline-row={row.key}
                data-deadline-state={row.done ? "done" : "todo"}
                className={cn(
                  "grid gap-4 rounded-2xl p-4 sm:grid-cols-[90px_minmax(0,1fr)_auto] sm:items-center",
                  row.done ? "bg-done-dim" : "bg-bg-secondary/55",
                )}
              >
                <div>
                  <p className={cn("text-body-sm font-semibold tabular-nums", tone.text)}>
                    {daysLabel(row.daysLeft)}
                  </p>
                  <p className="mt-1 text-caption text-text-faint">
                    {formatDate(row.deadline, "short")}
                  </p>
                </div>

                <div className="min-w-0">
                  <Link
                    href={href}
                    className="block truncate text-body font-semibold text-heading hover:text-link"
                  >
                    {row.title}
                  </Link>
                  <p className="mt-1 text-caption text-text-muted">
                    {row.kindLabel} · {row.done ? row.actionLabel : "To do"}
                  </p>
                  <div
                    className={cn("mt-2 h-1.5 overflow-hidden rounded-full", tone.track)}
                    role="progressbar"
                    aria-label={`${row.title}: ${daysLabel(row.daysLeft)}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={urgencyProgress(row)}
                  >
                    <span
                      className={cn("block h-full rounded-full", tone.fill)}
                      style={{ width: `${urgencyProgress(row)}%` }}
                    />
                  </div>
                </div>

                <CompletionPill
                  label={row.actionLabel}
                  checked={row.done}
                  onChange={onChange}
                  className="justify-self-start sm:justify-self-end"
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
