// Floor-domain tools for the admin assistant: inspect the live floor plan, list
// tables (and their combinable pairs) and floors, and the confirm-gated writes
// that move a party, join/unjoin tables, create/update/delete tables, persist a
// whole layout, manage floors, and set a floor's wall/zone shapes. All wrap the
// SAME server functions the admin UI uses — the AI never invents data, and every
// write audits with the ctx actor (default 'ai') on behalf of the confirming
// staff member (threaded as run()'s second arg by confirmTool). (WP-S6-3.)

import { moveBooking, createBooking, BookingError } from '$lib/server/booking/index.js';
import {
	getFloorPlan,
	getServiceTurns,
	listTables,
	listJoins,
	setJoins,
	createTable,
	updateTable,
	deleteTable,
	saveLayout,
	listFloors,
	createFloor,
	updateFloor,
	deleteFloor,
	listBookableAreas,
	setShapes
} from '$lib/server/booking/admin.js';
import type { DiningTable, Floor, FloorShape } from '$lib/server/db/types.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr, DESTRUCTIVE_PREFIX } from './types.js';

/** Floor-domain tools for a brand. */
export function floorTools(ctx: ToolContext): GeminiTool[] {
	const { brand, nowISO, actor, onBehalfOf } = ctx;
	// Confirm-gated writes thread the confirming staff id as run()'s second arg
	// (see geminiAgent.confirmTool); fall back to the ctx default otherwise.
	const obo = (confirmer?: string) => confirmer ?? onBehalfOf;

	// Resolve a table reference that may be either a PocketBase record id OR a
	// human label (e.g. "A7"). The model naturally echoes the label the user said
	// ("join A7 and A8"), so any table-targeting write must accept labels and map
	// them to ids — otherwise the relation create fails ("Failed to create
	// record"). Returns the resolved id, or the original value if no match (so a
	// genuine id still works and the downstream error stays meaningful).
	const resolveTableId = async (ref: string): Promise<string> => {
		const tables = await listTables(brand);
		const byId = tables.find((t) => t.id === ref);
		if (byId) return byId.id;
		const byLabel = tables.find((t) => t.label.toLowerCase() === ref.trim().toLowerCase());
		return byLabel ? byLabel.id : ref;
	};
	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'get_floor_plan',
			kind: 'read',
			description:
				'Get the live floor-plan state for a date as of now: each table with capacity, section, and whether it is free/upcoming/seated/overdue. Optionally scope to a single floor (id from list_floors); defaults to the first floor.',
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					floorId: {
						type: 'string',
						description: 'Optional floor id (from list_floors) to scope the plan to one floor.'
					}
				},
				required: ['date']
			},
			run: async ({ date, floorId }: { date: string; floorId?: string }) => {
				const { tables, floor, floors } = await getFloorPlan(brand, date, nowISO, floorId);
				return {
					floor: floor ? { id: floor.id, name: floor.name } : undefined,
					floors: floors.map((f) => ({ id: f.id, name: f.name })),
					tables: tables.map((t) => ({
						id: t.id,
						label: t.label,
						section: t.section,
						seats: `${t.seats_min}-${t.seats_max}`,
						bookable: t.bookable,
						state: t.state,
						heldBy: t.booking?.expand?.customer?.name
					}))
				};
			}
		},
		{
			name: 'get_tables_freeing_next',
			kind: 'read',
			description:
				"Which seated tables will free up next, soonest first (mf-turn-predict). For each currently-seated table: the guest, party size, seats, when it should free (predicted from how long similar parties actually sit when there's enough history, else the service turn default), how many minutes until it frees (negative = already overdue / lingering), and any upcoming booking it could turn over to. Use for 'what's freeing up next?', 'which tables are about to open?', 'anything running over?', 'can I fit a walk-in of N soon?'. Read-only. Resolve relative dates like 'tonight'/'today' to YYYY-MM-DD first; defaults to the first floor unless a floorId is given.",
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					floorId: {
						type: 'string',
						description: 'Optional floor id (from list_floors) to scope to one floor.'
					}
				},
				required: ['date']
			},
			run: async ({ date, floorId }: { date: string; floorId?: string }) => {
				const { freeingNext, matches, usingHistory } = await getServiceTurns(
					brand,
					date,
					nowISO,
					floorId
				);
				const matchByTable = new Map(matches.map((m) => [m.tableId, m]));
				const fmt = (ms: number) =>
					new Date(ms).toLocaleTimeString('en-GB', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'Europe/London'
					});
				return {
					estimateBasis: usingHistory
						? 'learned from recent actual turn times'
						: 'service turn defaults (not enough history yet)',
					seatedCount: freeingNext.length,
					// already sorted soonest-free first by getServiceTurns
					tables: freeingNext.map((t) => {
						const m = matchByTable.get(t.tableId);
						return {
							table: t.label,
							guest: t.guestName,
							party: t.partySize,
							seats: t.seatsMax,
							seatedForMinutes: t.seatedForMinutes,
							freesAt: fmt(t.freeAtMs),
							minutesUntilFree: t.minutesUntilFree,
							overdue: t.overdue,
							nextUp: m
								? `${m.guestName} (${m.partySize}p) at ${fmt(new Date(m.startsAt).getTime())}`
								: null
						};
					})
				};
			}
		},
		{
			name: 'list_tables',
			kind: 'read',
			description:
				'List every table with its capacity, section and which other tables it can be joined with (combinable pairs).',
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const [tables, joins] = await Promise.all([listTables(brand), listJoins(brand)]);
				const labelOf = new Map(tables.map((t) => [t.id, t.label]));
				const joinable = new Map<string, string[]>();
				const addJoin = (id: string, otherLabel: string) => {
					const list = joinable.get(id) ?? [];
					list.push(otherLabel);
					joinable.set(id, list);
				};
				for (const j of joins) {
					addJoin(j.table_a, labelOf.get(j.table_b) ?? j.table_b);
					addJoin(j.table_b, labelOf.get(j.table_a) ?? j.table_a);
				}
				return tables.map((t) => ({
					id: t.id,
					label: t.label,
					section: t.section,
					seats: `${t.seats_min}-${t.seats_max}`,
					bookable: t.bookable,
					floor: t.floor,
					canJoinWith: joinable.get(t.id) ?? []
				}));
			}
		},
		{
			name: 'list_floors',
			kind: 'read',
			description:
				'List every floor of the restaurant with its id, name, ordering and room dimensions (cm). Use the ids with get_floor_plan, set_shapes, create_table or manage_floor.',
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const floors = await listFloors(brand);
				return floors.map((f) => ({
					id: f.id,
					name: f.name,
					sortOrder: f.sort_order,
					widthCm: f.width_cm,
					heightCm: f.height_cm,
					pxPerCm: f.px_per_cm
				}));
			}
		},
		{
			name: 'list_areas',
			kind: 'read',
			description:
				"The bookable AREAS (sections) of the room — e.g. 'Front section', 'Bar area', 'Counter' — with how many bookable tables and total seats each holds. Use to answer 'what areas can we book out?' or before booking a whole area for a private group.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const areas = await listBookableAreas(brand);
				return areas.map((a) => ({
					section: a.section,
					tableCount: a.tableIds.length,
					tableLabels: a.tableLabels,
					seats: a.seatsMax
				}));
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'book_whole_area',
			kind: 'write',
			description:
				"Reserve an ENTIRE area (section) for one booking — e.g. a private party or function — by holding every bookable table in that area for the standard turn. Fails if any table in the area is already taken at that time. Use list_areas first for the exact section name. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					date: { ...dateStr, description: "Date, 'YYYY-MM-DD'." },
					time: { type: 'string', description: "Start time, 'HH:mm' (24h)." },
					section: { type: 'string', description: 'The exact area/section name from list_areas.' },
					partySize: { type: 'integer', description: "Number of guests (defaults to the area's full capacity if omitted)." },
					name: { type: 'string', description: 'Booking / function name.' }
				},
				required: ['date', 'time', 'section']
			},
			run: async (args: {
				date: string;
				time: string;
				section: string;
				partySize?: number;
				name?: string;
			}) => {
				const areas = await listBookableAreas(brand);
				const area = areas.find((a) => a.section.toLowerCase() === args.section.trim().toLowerCase());
				if (!area || area.tableIds.length === 0) {
					return { ok: false, error: `No bookable area named "${args.section}".` };
				}
				const partySize = args.partySize && args.partySize > 0 ? args.partySize : area.seatsMax;
				try {
					const { booking } = await createBooking({
						brand,
						date: args.date,
						time: args.time,
						partySize,
						customer: { name: args.name?.trim() || `${area.section} — area booking`, email: '' },
						occasion: `Whole-area booking · ${area.section}`,
						source: 'phone',
						staff: true,
						staffId: onBehalfOf,
						tableIds: area.tableIds
					});
					return {
						ok: true,
						bookingId: booking.id,
						section: area.section,
						tables: area.tableLabels,
						partySize
					};
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'move_booking',
			kind: 'write',
			description:
				'Move a booking onto a different set of tables (e.g. to free up space or join tables for a bigger party). WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					bookingId: {
						type: 'string',
						description: 'The booking to move (id from get_bookings_for_day).'
					},
					tableIds: {
						type: 'array',
						items: { type: 'string' },
						description: 'The new table id(s) to assign. Use 2+ ids to combine tables.'
					}
				},
				required: ['bookingId', 'tableIds']
			},
			run: ({ bookingId, tableIds }: { bookingId: string; tableIds: string[] }) =>
				moveBooking(bookingId, tableIds, nowISO, actor)
		},
		{
			name: 'join_tables',
			kind: 'write',
			description:
				'Mark a pair of tables as combinable so the booking engine can seat a larger party across them. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					tableIdA: { type: 'string' },
					tableIdB: { type: 'string' }
				},
				required: ['tableIdA', 'tableIdB']
			},
			run: async (
				{ tableIdA, tableIdB }: { tableIdA: string; tableIdB: string },
				confirmer?: string
			) => {
				// Accept labels ("A7") or ids — the model echoes whatever the user said.
				const a = await resolveTableId(tableIdA);
				const b = await resolveTableId(tableIdB);
				const existing = await listJoins(brand);
				const desired = existing.map((j) => ({ table_a: j.table_a, table_b: j.table_b }));
				const key = (x: string, y: string) => [x, y].sort().join('|');
				if (!desired.some((d) => key(d.table_a, d.table_b) === key(a, b))) {
					desired.push({ table_a: a, table_b: b });
				}
				await setJoins(brand, desired, actor, obo(confirmer));
				return { joined: [a, b] };
			}
		},
		{
			name: 'unjoin_tables',
			kind: 'write',
			description:
				'Remove a combinable pair so two tables are no longer joinable for a single party. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					tableIdA: { type: 'string' },
					tableIdB: { type: 'string' }
				},
				required: ['tableIdA', 'tableIdB']
			},
			run: async (
				{ tableIdA, tableIdB }: { tableIdA: string; tableIdB: string },
				confirmer?: string
			) => {
				const ta = await resolveTableId(tableIdA);
				const tb = await resolveTableId(tableIdB);
				const existing = await listJoins(brand);
				const key = (a: string, b: string) => [a, b].sort().join('|');
				const target = key(ta, tb);
				const desired = existing
					.filter((j) => key(j.table_a, j.table_b) !== target)
					.map((j) => ({ table_a: j.table_a, table_b: j.table_b }));
				await setJoins(brand, desired, actor, obo(confirmer));
				return { unjoined: [ta, tb], remaining: desired.length };
			}
		},
		{
			name: 'create_table',
			kind: 'write',
			description:
				'Add a new table to the floor plan. Capacity, section, shape, floor and geometry are optional and default sensibly. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					label: { type: 'string', description: "Table label, e.g. 'T12'." },
					seatsMin: { type: 'integer', description: 'Minimum party size (default 2).' },
					seatsMax: { type: 'integer', description: 'Maximum party size (default 4).' },
					section: { type: 'string', description: "Section name, e.g. 'Main' or 'Terrace'." },
					bookable: {
						type: 'boolean',
						description: 'Whether the table is online-bookable (false = walk-in only).'
					},
					floorId: { type: 'string', description: 'Floor id (from list_floors) to place it on.' },
					shape: { type: 'string', description: "Table shape: 'rect' or 'round'." }
				},
				required: ['label']
			},
			run: (
				input: {
					label: string;
					seatsMin?: number;
					seatsMax?: number;
					section?: string;
					bookable?: boolean;
					floorId?: string;
					shape?: string;
				},
				confirmer?: string
			) => {
				const data: Partial<DiningTable> = { label: input.label };
				if (input.seatsMin != null) data.seats_min = input.seatsMin;
				if (input.seatsMax != null) data.seats_max = input.seatsMax;
				if (input.section != null) data.section = input.section as DiningTable['section'];
				if (input.bookable != null) data.bookable = input.bookable;
				if (input.floorId != null) data.floor = input.floorId;
				if (input.shape != null) data.shape = input.shape as DiningTable['shape'];
				return createTable(brand, data, actor, obo(confirmer));
			}
		},
		{
			name: 'update_table',
			kind: 'write',
			description:
				'Update an existing table — label, capacity, section, bookable flag, or which floor it sits on. Only the fields you pass change. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					tableId: { type: 'string', description: 'The table to update (id from list_tables).' },
					label: { type: 'string' },
					seatsMin: { type: 'integer' },
					seatsMax: { type: 'integer' },
					section: { type: 'string' },
					bookable: { type: 'boolean' },
					floorId: { type: 'string', description: 'Move the table to this floor id.' }
				},
				required: ['tableId']
			},
			run: (
				input: {
					tableId: string;
					label?: string;
					seatsMin?: number;
					seatsMax?: number;
					section?: string;
					bookable?: boolean;
					floorId?: string;
				},
				confirmer?: string
			) => {
				const data: Partial<DiningTable> = {};
				if (input.label != null) data.label = input.label;
				if (input.seatsMin != null) data.seats_min = input.seatsMin;
				if (input.seatsMax != null) data.seats_max = input.seatsMax;
				if (input.section != null) data.section = input.section as DiningTable['section'];
				if (input.bookable != null) data.bookable = input.bookable;
				if (input.floorId != null) data.floor = input.floorId;
				return updateTable(input.tableId, data, actor, obo(confirmer));
			}
		},
		{
			name: 'delete_table',
			kind: 'write',
			description:
				DESTRUCTIVE_PREFIX +
					' Permanently remove a table from the floor plan. HIGH-IMPACT WRITE — must be confirmed before it runs. Check the table is empty (get_floor_plan) and has no future bookings first.',
			parameters: {
				type: 'object',
				properties: {
					tableId: { type: 'string', description: 'The table to delete (id from list_tables).' }
				},
				required: ['tableId']
			},
			run: async ({ tableId }: { tableId: string }, confirmer?: string) => {
				await deleteTable(tableId, actor, obo(confirmer));
				return { deleted: tableId };
			}
		},
		{
			name: 'save_layout',
			kind: 'write',
			description:
				'Persist floor-plan geometry for one or more tables at once (positions, sizes in cm, rotation, floor). WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					positions: {
						type: 'array',
						description: 'Each table whose geometry should be saved.',
						items: {
							type: 'object',
							properties: {
								id: { type: 'string' },
								x: { type: 'number' },
								y: { type: 'number' },
								width: { type: 'number' },
								height: { type: 'number' },
								widthCm: { type: 'number' },
								heightCm: { type: 'number' },
								rotation: { type: 'number' },
								floorId: { type: 'string' }
							},
							required: ['id', 'x', 'y']
						}
					}
				},
				required: ['positions']
			},
			run: async (
				{
					positions
				}: {
					positions: Array<{
						id: string;
						x: number;
						y: number;
						width?: number;
						height?: number;
						widthCm?: number;
						heightCm?: number;
						rotation?: number;
						floorId?: string;
					}>;
				},
				confirmer?: string
			) => {
				await saveLayout(
					positions.map((p) => ({
						id: p.id,
						x: p.x,
						y: p.y,
						width: p.width,
						height: p.height,
						width_cm: p.widthCm,
						height_cm: p.heightCm,
						rotation: p.rotation,
						floor: p.floorId
					})),
					actor,
					obo(confirmer)
				);
				return { saved: positions.length };
			}
		},
		{
			name: 'manage_floor',
			kind: 'write',
			description:
				"Create, update or delete a floor. action='create' adds a floor (name + optional size); action='update' changes name/size/order of floorId; action='delete' removes an EMPTY floor (move its tables off first). Deleting a floor is HIGH-IMPACT. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					action: { type: 'string', enum: ['create', 'update', 'delete'] },
					floorId: {
						type: 'string',
						description: 'The floor to update or delete (required for update/delete).'
					},
					name: { type: 'string', description: "Floor name, e.g. 'Mezzanine'." },
					sortOrder: { type: 'integer' },
					widthCm: { type: 'number' },
					heightCm: { type: 'number' },
					pxPerCm: { type: 'number' }
				},
				required: ['action']
			},
			run: async (
				input: {
					action: 'create' | 'update' | 'delete';
					floorId?: string;
					name?: string;
					sortOrder?: number;
					widthCm?: number;
					heightCm?: number;
					pxPerCm?: number;
				},
				confirmer?: string
			) => {
				const data: Partial<Floor> = {};
				if (input.name != null) data.name = input.name;
				if (input.sortOrder != null) data.sort_order = input.sortOrder;
				if (input.widthCm != null) data.width_cm = input.widthCm;
				if (input.heightCm != null) data.height_cm = input.heightCm;
				if (input.pxPerCm != null) data.px_per_cm = input.pxPerCm;
				if (input.action === 'create') {
					const floor = await createFloor(brand, data, actor, obo(confirmer));
					return { created: floor.id, name: floor.name };
				}
				if (input.action === 'update') {
					if (!input.floorId) throw new Error('floorId is required to update a floor.');
					const floor = await updateFloor(input.floorId, data, actor, obo(confirmer));
					return { updated: floor.id, name: floor.name };
				}
				// delete
				if (!input.floorId) throw new Error('floorId is required to delete a floor.');
				await deleteFloor(input.floorId, actor, obo(confirmer));
				return { deleted: input.floorId };
			}
		},
		{
			name: 'set_shapes',
			kind: 'write',
			description:
				"Replace the non-table elements (walls, zones, pillars, bars, doors, labels) drawn on a floor. The passed set becomes the floor's complete shape list — omitted existing shapes are removed. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					floorId: { type: 'string', description: 'The floor whose shapes to set (from list_floors).' },
					shapes: {
						type: 'array',
						description: "The complete desired set of shapes for the floor. Pass an existing shape's id to keep/update it; omit id to create a new one.",
						items: {
							type: 'object',
							properties: {
								id: { type: 'string' },
								kind: {
									type: 'string',
									enum: ['wall', 'zone', 'label', 'pillar', 'bar', 'blocked', 'door']
								},
								x: { type: 'number' },
								y: { type: 'number' },
								width: { type: 'number' },
								height: { type: 'number' },
								rotation: { type: 'number' },
								label: { type: 'string' },
								color: { type: 'string' }
							}
						}
					}
				},
				required: ['floorId', 'shapes']
			},
			run: async (
				{
					floorId,
					shapes
				}: {
					floorId: string;
					shapes: Array<Partial<FloorShape> & { id?: string }>;
				},
				confirmer?: string
			) => {
				await setShapes(floorId, shapes, actor, obo(confirmer));
				return { floorId, shapes: shapes.length };
			}
		}
	];
}
