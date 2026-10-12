// Shared types for the per-domain admin tool registries. Each domain module
// exports a factory `xxxTools(ctx: ToolContext): GeminiTool[]`; the composer in
// ./index.ts concatenates them into the full admin tool set. This is the clean
// merge point: a new stream adds ONE domain module + registers it in index.ts,
// without touching any other domain's tools.

import type { BrandId, AuditActor, StaffRole } from '$lib/server/db/types.js';
import type { GeminiTool, ToolKind, UiDirective } from '../geminiAgent.js';

// Re-export the agent's tool primitives so domain modules import from one place.
export type { GeminiTool, ToolKind, UiDirective };

/** Per-request context handed to every domain tool factory. `actor`/`onBehalfOf`
 *  /`role` come from F1 `event.locals.staff`; until WP-S6-5 threads the real
 *  session the back-compat shim builds a default ctx with actor='ai'. */
export interface ToolContext {
	brand: BrandId;
	/** The moment of the request, ISO-8601. */
	nowISO: string;
	/** Audit actor for writes — defaults to 'ai' for the assistant. */
	actor: AuditActor;
	/** Staff member a write is performed on behalf of (audit trail). */
	onBehalfOf?: string;
	/** Caller's role, for RBAC gating of write tools. */
	role?: StaffRole;
}

/** A `date` string parameter spec, reused across read tools. */
export const dateStr = {
	type: 'string',
	description: "Local date as 'YYYY-MM-DD'. Resolve relative dates first."
};

/**
 * Contract between destructive write tools (WP-S6-3 floor, WP-S6-6 payments) and
 * the confirm UI (WP-S6-6). A high-blast-radius write tags its `description` by
 * STARTING it with this prefix; the assistant UI detects the prefix, derives a
 * `confirmStrength: 'type'`, requires the operator to type a confirmation word
 * before the Confirm button enables, and STRIPS the prefix from the text it
 * shows. Keeping it a single exported const (not a magic string) means the
 * producer and the consumer never drift. Currently tagged: delete_table,
 * manage_floor(action:'delete'), refund_deposit.
 */
export const DESTRUCTIVE_PREFIX = 'DESTRUCTIVE:';
