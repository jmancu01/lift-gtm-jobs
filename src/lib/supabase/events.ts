import { randomUUID } from "node:crypto";
import { createSupabaseClient } from "./client.js";
import type { LeadEvent } from "./types.js";

export function generateRunId(): string {
  return randomUUID();
}

export async function logEvents(events: LeadEvent[]): Promise<void> {
  if (events.length === 0) return;
  const client = createSupabaseClient();
  const rows = events.map((event) => {
    const { detail, created_at, ...rest } = event;
    return {
      ...rest,
      detail: detail ?? {},
      created_at: created_at || new Date().toISOString(),
    };
  });
  const { error } = await client.from("lead_events").insert(rows);
  if (error) {
    console.error(`Failed to log events (non-blocking): ${error.message}`, {
      count: rows.length,
    });
  }
}
