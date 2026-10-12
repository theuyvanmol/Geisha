/**
 * Ranked table-join options for a party that won't fit one table.
 *
 * The diary's Book modal used to compute exactly ONE suggestion, so a host
 * booking a large party saw "use 33 + 34 + 35" and nothing else — even though
 * the floor has dozens of workable combinations (owner: "I know there is loads
 * more"). This builds the whole list and RANKS it, because the raw list is
 * unusable: a party of 12 on Asia's floor has 104 same-section combinations,
 * most of them nonsense like 20 + 26 + 27 spanning the width of the room.
 *
 * What we can honestly rank by, given the data that actually exists:
 *
 *   saved  — one of the restaurant's configured chains (Settings → Table Joins),
 *            with the capacity the chain STATES (a pushed-together run seats more
 *            than its printed maximums add up to).
 *   known  — every table links to the others through those chains, even where the
 *            exact set isn't itself saved.
 *   run    — one section, consecutive table numbers. A heuristic, and the one that
 *            does the real work: `geisha_table_joins` is empty on this estate and
 *            the chains cover only 15 of Asia's 37 tables, so without it a party of
 *            12 gets two options. Table numbering runs along the room, so
 *            consecutive almost always means adjacent.
 *   loose  — same section, any combination. Ranked last and meant to sit behind a
 *            "show everything" affordance, never hidden outright.
 *
 * Nothing here BLOCKS a combination: staff can pin any tables they like in the
 * modal, and the server's explicit-tableIds path validates only fit and free (see
 * queries.ts getJoins). These tiers decide order, not permission.
 */

export type JoinTier = 'saved' | 'known' | 'run' | 'loose';

/** A table as the Book modal knows it — the fields of TableStatusRow we need. */
export interface JoinTable {
	id: string;
	label: string;
	seatsMax: number;
	section: string;
	/** False when a real booking holds it in the window being booked. */
	free: boolean;
}

/** A configured chain (ResDiary "Table Joins"): which tables, and what they seat. */
export interface JoinChain {
	tableIds: string[];
	/** Stated capacity of the pushed-together run; 0 = fall back to the sum. */
	capacity: number;
}

export interface JoinOption {
	ids: string[];
	seats: number;
	tier: JoinTier;
	/** The section the combination sits in, '' if it spans more than one. */
	section: string;
}

export interface BuildJoinOptionsInput {
	tables: JoinTable[];
	chains: JoinChain[];
	party: number;
	/** Restrict to one section; '' or undefined considers the whole floor. */
	area?: string;
}

/** Unordered set key, so 33+34 and 34+33 are the same combination. */
const keyOf = (ids: string[]): string => [...ids].sort().join('|');

export function buildJoinOptions(input: BuildJoinOptionsInput): JoinOption[] {
	const { tables, chains, party, area } = input;
	const inArea = (t: JoinTable) => !area || t.section === area;
	const usable = tables.filter((t) => t.free && inArea(t));

	// A single table holds them: this is not a join problem at all.
	if (usable.some((t) => t.seatsMax >= party)) return [];

	const byId = new Map(tables.map((t) => [t.id, t]));
	const isUsable = (id: string) => {
		const t = byId.get(id);
		return !!t && t.free && inArea(t);
	};

	const options: JoinOption[] = [];

	// 1. SAVED — the restaurant's own chains, at the capacity they state.
	for (const ch of chains) {
		if (!ch.tableIds.every(isUsable)) continue;
		const seats =
			ch.capacity > 0
				? ch.capacity
				: ch.tableIds.reduce((n, id) => n + (byId.get(id)?.seatsMax ?? 0), 0);
		if (seats < party) continue;
		const sections = new Set(ch.tableIds.map((id) => byId.get(id)!.section));
		options.push({
			ids: [...ch.tableIds],
			seats,
			tier: 'saved',
			section: sections.size === 1 ? [...sections][0] : ''
		});
	}

	// 2-4. Everything else is built per SECTION: tables are pushed together, and
	// you cannot push one across the room. Each combination is MINIMAL — once it
	// seats the party we stop extending it, so 10+11+12 is offered but 10+11+12+13
	// (which only wastes a table) is not.
	const partners = chainPartners(chains);
	for (const section of [...new Set(usable.map((t) => t.section))]) {
		const pool = usable
			.filter((t) => t.section === section && t.seatsMax > 0)
			.sort((a, b) => compareLabels(a.label, b.label));
		const walk = (start: number, picked: JoinTable[], seats: number) => {
			if (picked.length > 1 && seats >= party) {
				const ids = picked.map((t) => t.id);
				options.push({ ids, seats, tier: tierOf(ids, partners, byId), section });
				return;
			}
			if (picked.length >= MAX_TABLES_PER_JOIN) return;
			for (let i = start; i < pool.length; i++) {
				walk(i + 1, [...picked, pool[i]], seats + pool[i].seatsMax);
			}
		};
		walk(0, [], 0);
	}

	const rank: Record<JoinTier, number> = { saved: 0, known: 1, run: 2, loose: 3 };
	return dedupe(options).sort(
		(a, b) =>
			rank[a.tier] - rank[b.tier] ||
			a.ids.length - b.ids.length ||
			a.seats - b.seats ||
			labelsOf(a, byId).localeCompare(labelsOf(b, byId))
	);
}

/** How many tables the floor will realistically push together for one party. */
const MAX_TABLES_PER_JOIN = 4;

export interface PickableGroup<T extends JoinTable = JoinTable> {
	/** optgroup heading: 'Joins with 33 + 34', a section name, or 'Other tables'. */
	label: string;
	tables: T[];
}

/**
 * The "add another table" list, ordered by how likely each table is to be the one
 * the host wants next: the chain partners of what they've already picked, then the
 * rest of that section, then the whole floor.
 *
 * EVERY table appears somewhere — a taken one included, so the picker can show it
 * greyed rather than pretend it doesn't exist. Ordering is the whole job here;
 * refusing a choice is not (owner: "admins should be able to do anything").
 */
export function groupPickableTables<T extends JoinTable>(input: {
	tables: T[];
	chains: JoinChain[];
	selectedIds: string[];
}): PickableGroup<T>[] {
	const { tables, chains, selectedIds } = input;
	const byId = new Map(tables.map((t) => [t.id, t]));
	const selected = selectedIds.map((id) => byId.get(id)).filter((t): t is T => !!t);
	const available = tables
		.filter((t) => !selectedIds.includes(t.id))
		.sort((a, b) => compareLabels(a.label, b.label));

	const bySection = (): PickableGroup<T>[] =>
		[...new Set(available.map((t) => t.section))]
			.sort((a, b) => a.localeCompare(b))
			.map((section) => ({
				label: section || 'Other tables',
				tables: available.filter((t) => t.section === section)
			}))
			.filter((g) => g.tables.length > 0);

	// Nothing picked yet: there is no "next" to be clever about, so just the floor.
	if (!selected.length) return bySection();

	const partners = chainPartners(chains);
	const partnerIds = new Set<string>();
	for (const t of selected) {
		for (const id of partners.get(t.id) ?? []) {
			if (!selectedIds.includes(id)) partnerIds.add(id);
		}
	}
	const sections = new Set(selected.map((t) => t.section));

	const groups: PickableGroup<T>[] = [];
	const taken = new Set<string>();
	const claim = (label: string, rows: T[]) => {
		const fresh = rows.filter((t) => !taken.has(t.id));
		if (!fresh.length) return;
		fresh.forEach((t) => taken.add(t.id));
		groups.push({ label, tables: fresh });
	};

	claim(
		`Joins with ${selected.map((t) => t.label).join(' + ')}`,
		available.filter((t) => partnerIds.has(t.id))
	);
	for (const section of [...sections].sort((a, b) => a.localeCompare(b))) {
		claim(
			section || 'Other tables',
			available.filter((t) => t.section === section)
		);
	}
	claim('Other tables', available);
	return groups;
}

/** id → the ids it shares a configured chain with (the only adjacency we hold). */
function chainPartners(chains: JoinChain[]): Map<string, Set<string>> {
	const partners = new Map<string, Set<string>>();
	for (const ch of chains) {
		for (const a of ch.tableIds) {
			for (const b of ch.tableIds) {
				if (a === b) continue;
				const set = partners.get(a) ?? new Set<string>();
				set.add(b);
				partners.set(a, set);
			}
		}
	}
	return partners;
}

/**
 * 'known' when the whole set hangs together through the configured chains,
 * 'run' when the labels are consecutive numbers, otherwise 'loose'.
 */
function tierOf(
	ids: string[],
	partners: Map<string, Set<string>>,
	byId: Map<string, JoinTable>
): JoinTier {
	if (isConnected(ids, partners)) return 'known';
	const numbers = ids.map((id) => numberOf(byId.get(id)?.label ?? ''));
	if (numbers.every((n) => n !== null)) {
		const sorted = (numbers as number[]).slice().sort((a, b) => a - b);
		if (sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)) return 'run';
	}
	return 'loose';
}

/** Is every table reachable from the first one through chain links? */
function isConnected(ids: string[], partners: Map<string, Set<string>>): boolean {
	if (ids.length < 2) return false;
	const inSet = new Set(ids);
	const seen = new Set([ids[0]]);
	const queue = [ids[0]];
	while (queue.length) {
		const cur = queue.pop()!;
		for (const next of partners.get(cur) ?? []) {
			if (inSet.has(next) && !seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return seen.size === ids.length;
}

/** '33' → 33; 'Bar 1' → 1; a label with no digits → null (never a run). */
function numberOf(label: string): number | null {
	const digits = label.replace(/\D/g, '');
	return digits ? Number(digits) : null;
}

/** Table labels sort like a floor plan: 2 before 10, not after it. */
function compareLabels(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true });
}

const labelsOf = (o: JoinOption, byId: Map<string, JoinTable>): string =>
	o.ids.map((id) => byId.get(id)?.label ?? '').join(' + ');

function dedupe(options: JoinOption[]): JoinOption[] {
	const seen = new Set<string>();
	return options.filter((o) => {
		const k = keyOf(o.ids);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}
