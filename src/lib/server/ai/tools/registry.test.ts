// Registry coverage for the admin assistant tool catalogue. Builds the full tool
// set and asserts the tools the operator-facing features need are REGISTERED with
// the right kind + a well-formed parameter schema. This is the guard that a new
// capability (waitlist, closures, customer edits, deposit rules, area booking,
// confirm) is actually exposed to the model — the gap that made the assistant say
// "I haven't got tools for that". The tool bodies hit PocketBase, so we only
// inspect the declarations here (run() is covered by the domain tests + live MCP).

import { describe, it, expect } from 'vitest';
import { adminTools, type ToolContext } from './index.js';

const ctx: ToolContext = {
	brand: 'asia',
	nowISO: '2026-06-29T18:00:00.000Z',
	actor: 'ai'
};

const tools = adminTools(ctx);
const byName = new Map(tools.map((t) => [t.name, t]));

/** Every tool declares a name, a valid kind, a description, and an object schema. */
describe('tool catalogue shape', () => {
	it('every tool is well-formed', () => {
		for (const t of tools) {
			expect(t.name, 'name').toBeTruthy();
			expect(['read', 'write', 'ui']).toContain(t.kind);
			expect(t.description.length, `${t.name} description`).toBeGreaterThan(10);
			expect((t.parameters as { type?: string }).type, `${t.name} params`).toBe('object');
			expect(typeof t.run, `${t.name} run`).toBe('function');
		}
	});

	it('tool names are unique', () => {
		expect(byName.size).toBe(tools.length);
	});
});

/** The previously-missing capabilities are now registered (the actual fix). */
describe('newly-added tools are registered', () => {
	const expected: Record<string, 'read' | 'write' | 'ui'> = {
		// booking lifecycle gap
		confirm_booking: 'write',
		// waitlist domain (was entirely absent)
		get_waitlist: 'read',
		add_to_waitlist: 'write',
		notify_waitlist: 'write',
		seat_from_waitlist: 'write',
		convert_waitlist: 'write',
		remove_from_waitlist: 'write',
		// customer edits (was read-only)
		set_customer_vip: 'write',
		tag_customer: 'write',
		set_customer_allergies: 'write',
		update_customer_notes: 'write',
		// areas / whole-area booking
		list_areas: 'read',
		book_whole_area: 'write',
		// closures
		list_closures: 'read',
		create_closure: 'write',
		delete_closure: 'write',
		// deposit / pacing rules
		list_deposit_rules: 'read',
		create_deposit_rule: 'write',
		delete_deposit_rule: 'write',
		list_pacing_rules: 'read',
		// site announcement banner
		get_banner: 'read',
		set_banner: 'write',
		hide_banner: 'write',
		// site content (CMS) — read + the open-the-editor UI tool (no blind write)
		list_content: 'read',
		get_content: 'read',
		open_content: 'ui'
	};

	for (const [name, kind] of Object.entries(expected)) {
		it(`${name} is registered as a ${kind} tool`, () => {
			const t = byName.get(name);
			expect(t, `${name} missing from catalogue`).toBeDefined();
			expect(t!.kind).toBe(kind);
		});
	}
});

/** The pre-existing core lifecycle tools are still present (no regression). */
describe('existing tools survive', () => {
	for (const name of [
		'check_availability',
		'create_booking',
		'amend_booking',
		'cancel_booking',
		'move_booking',
		'get_diary',
		'search_customers',
		'open_settings'
	]) {
		it(`${name} still registered`, () => {
			expect(byName.has(name)).toBe(true);
		});
	}
});

/** Write tools that take an id require it (so the model can't fire a blind write). */
describe('write tools require their target id', () => {
	const idRequired: Record<string, string> = {
		confirm_booking: 'bookingId',
		notify_waitlist: 'id',
		delete_closure: 'id',
		delete_deposit_rule: 'id',
		set_customer_vip: 'customerId'
	};
	for (const [name, field] of Object.entries(idRequired)) {
		it(`${name} requires ${field}`, () => {
			const params = byName.get(name)!.parameters as { required?: string[] };
			expect(params.required ?? []).toContain(field);
		});
	}
});

/** The content tools require the `key` they operate on. */
describe('content tools require their key', () => {
	for (const name of ['get_content', 'open_content']) {
		it(`${name} requires key`, () => {
			const params = byName.get(name)!.parameters as { required?: string[] };
			expect(params.required ?? []).toContain('key');
		});
	}
});
