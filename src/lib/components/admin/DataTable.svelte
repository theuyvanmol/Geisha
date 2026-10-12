<script lang="ts" module>
	export type Column = {
		/** Key into the row record whose value is shown in this column. */
		key: string;
		/** Column header text. */
		label: string;
		/** Cell text alignment (default 'left'). */
		align?: 'left' | 'center' | 'right';
	};
</script>

<script lang="ts" generics="Row extends Record<string, unknown>">
	// DataTable — the standard admin table.
	//
	// A token-styled table (white surface, hairline border, striped rows, an
	// uppercase muted header) driven by a `columns` spec and a `rows` array.
	// By default each cell renders String(row[column.key]); pass a `row` snippet
	// to take over rendering of a whole row (receiving the row record + index).
	//
	//   import DataTable from '$lib/components/admin/DataTable.svelte';
	//   <DataTable {columns} {rows} empty="No bookings yet." />
	//
	//   <DataTable {columns} {rows}>
	//     {#snippet row(r)}
	//       <td>{r.name}</td>
	//       <td><StatusPill status={r.status} /></td>
	//     {/snippet}
	//   </DataTable>

	import type { Snippet } from 'svelte';

	let {
		columns,
		rows,
		row,
		empty = 'Nothing to show.'
	}: {
		columns: Column[];
		rows: Row[];
		/** Custom renderer for a row's cells (must emit <td> elements). */
		row?: Snippet<[Row, number]>;
		empty?: string;
	} = $props();
</script>

<div class="a-table-wrap">
	<table class="a-table">
		<thead>
			<tr>
				{#each columns as col (col.key)}
					<th style:text-align={col.align ?? 'left'}>{col.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if rows.length === 0}
				<tr class="a-table-empty">
					<td colspan={columns.length}>{empty}</td>
				</tr>
			{:else}
				{#each rows as r, i (i)}
					<tr>
						{#if row}
							{@render row(r, i)}
						{:else}
							{#each columns as col (col.key)}
								<td style:text-align={col.align ?? 'left'}>{String(r[col.key] ?? '')}</td>
							{/each}
						{/if}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.a-table-wrap {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-lg);
		overflow: hidden;
		font-family: var(--admin-font, inherit);
	}
	.a-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
		color: var(--admin-ink);
	}
	.a-table thead th {
		background: var(--admin-surface-2);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--admin-muted);
		padding: var(--admin-space-2) var(--admin-space-3);
		border-bottom: 1px solid var(--admin-border);
	}
	.a-table tbody td {
		padding: var(--admin-space-2) var(--admin-space-3);
		border-bottom: 1px solid var(--admin-border);
		vertical-align: middle;
	}
	.a-table tbody tr:last-child td {
		border-bottom: 0;
	}
	.a-table tbody tr:nth-child(even):not(.a-table-empty) td {
		background: color-mix(in srgb, var(--admin-surface-2) 45%, transparent);
	}
	.a-table-empty td {
		text-align: center;
		color: var(--admin-muted);
		padding: var(--admin-space-5) var(--admin-space-3);
	}
</style>
