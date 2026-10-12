// Registration + schema sanity for the diary tools. Doesn't hit the DB (the run()
// handlers wrap server functions covered elsewhere) — it asserts the tools are
// composed into the admin set, are READ-kind, and carry well-formed parameter
// schemas that the confirm-time validator accepts. This catches the common
// breakages: a tool not registered, a malformed schema, or a write/read mix-up.

import { describe, it, expect } from 'vitest';
import { diaryTools } from './toolsDiary.js';
import { adminTools } from './index.js';
import type { ToolContext } from './types.js';

const ctx: ToolContext = { brand: 'asia', nowISO: '2026-06-27T18:00:00.000Z', actor: 'ai' };

const EXPECTED = ['get_diary', 'find_table_gaps', 'who_is_late', 'suggest_seating', 'get_service_periods'];

describe('diary tools', () => {
	it('exposes the expected diary read tools', () => {
		const names = diaryTools(ctx).map((t) => t.name);
		for (const n of EXPECTED) expect(names).toContain(n);
	});

	it('are all READ tools (no accidental writes that would need confirmation)', () => {
		for (const t of diaryTools(ctx)) expect(t.kind).toBe('read');
	});

	it('are registered in the composed admin tool set', () => {
		const names = adminTools(ctx).map((t) => t.name);
		for (const n of EXPECTED) expect(names).toContain(n);
	});

	it('have well-formed object parameter schemas with valid required keys', () => {
		for (const t of diaryTools(ctx)) {
			const p = t.parameters as { type?: string; properties?: Record<string, unknown>; required?: string[] };
			expect(p.type).toBe('object');
			expect(typeof p.properties).toBe('object');
			// every required key must be declared in properties
			for (const key of p.required ?? []) expect(p.properties).toHaveProperty(key);
		}
	});

	it('have non-empty descriptions so the model knows when to call them', () => {
		for (const t of diaryTools(ctx)) expect(t.description.length).toBeGreaterThan(40);
	});
});
