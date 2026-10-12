// Runtime re-validation of a confirmed WRITE tool's input against the exact
// `parameters` schema that tool already declares (WP-S1-2).
//
// WHY: the confirm branch of /api/admin-chat used to pass the
// client-supplied `input` straight into the tool's run() with only a loose Zod
// `z.unknown()` gate. A confirmed write tool must NOT run with arbitrary input —
// so before run() we re-check the payload against the tool's own JSON-schema-ish
// `parameters` (the same spec the model is constrained by at call time).
//
// This is intentionally a SMALL validator covering only the JSON-schema subset
// the live tools actually declare:
//   - top-level (and nested) type:'object' with `properties` + `required[]`
//   - property types: 'string' | 'integer' | 'number' | 'boolean'
//   - 'array' with `items` (recursively validated)
//   - 'object' (recursively validated; its own properties/required)
//   - `enum` (value must be one of the listed members)
//   - an UNTYPED property (no `type`) accepts any value — update_setting.value
//     is deliberately untyped (number|string), so it must pass through.
// Unknown extra keys on an object are REJECTED (writes get the strict treatment).
// No coercion happens here: numeric coercion is left to the tool's own run()
// (e.g. update_setting coerces "10" → 10 against SETTING_META).

type Schema = Record<string, unknown>;

export type ValidateResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; errors: string[] };

/** A JS "kind" used in error messages. */
function kindOf(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}

/** Path-prefix for a nested error, e.g. "customer.email" or "tableIds[0]". */
function at(path: string): string {
	return path ? `${path}: ` : '';
}

/**
 * Validate `input` against a tool's `parameters` schema. The top-level schema is
 * expected to be an object schema (every live tool declares type:'object'); if it
 * isn't an object schema we still validate `input` against whatever it describes.
 */
export function validateToolInput(schema: Schema, input: unknown): ValidateResult {
	const errors: string[] = [];
	const value = checkValue(schema, input, '', errors);
	if (errors.length) return { ok: false, errors };
	// Top-level result is the (object) value the caller will hand to run().
	return { ok: true, value: (value ?? {}) as Record<string, unknown> };
}

/** Recursively validate one value against one (sub)schema. Returns the value
 *  unchanged on success; pushes messages into `errors` on failure. */
function checkValue(schema: Schema, value: unknown, path: string, errors: string[]): unknown {
	// `enum`: value must be a listed member (checked before/around type).
	const enumMembers = schema.enum;
	if (Array.isArray(enumMembers)) {
		if (!enumMembers.includes(value as never)) {
			errors.push(`${at(path)}must be one of ${JSON.stringify(enumMembers)}`);
			return value;
		}
	}

	const type = schema.type;

	// Untyped property → accept any value (e.g. update_setting.value). An enum
	// without a type is still honoured above.
	if (type === undefined) return value;

	switch (type) {
		case 'object':
			return checkObject(schema, value, path, errors);
		case 'array':
			return checkArray(schema, value, path, errors);
		case 'string':
			if (typeof value !== 'string') errors.push(`${at(path)}expected string, got ${kindOf(value)}`);
			return value;
		case 'boolean':
			if (typeof value !== 'boolean')
				errors.push(`${at(path)}expected boolean, got ${kindOf(value)}`);
			return value;
		case 'integer':
			if (typeof value !== 'number' || !Number.isInteger(value))
				errors.push(`${at(path)}expected integer, got ${kindOf(value)}`);
			return value;
		case 'number':
			if (typeof value !== 'number' || Number.isNaN(value))
				errors.push(`${at(path)}expected number, got ${kindOf(value)}`);
			return value;
		default:
			// Unknown schema type — don't block (forward-compat), accept the value.
			return value;
	}
}

/** Validate an object value: required keys present, known keys typed, no extras. */
function checkObject(schema: Schema, value: unknown, path: string, errors: string[]): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		errors.push(`${at(path)}expected object, got ${kindOf(value)}`);
		return value;
	}
	const obj = value as Record<string, unknown>;
	const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
	const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

	// Reject unknown keys (strict for writes).
	for (const key of Object.keys(obj)) {
		if (!(key in properties)) {
			errors.push(`${at(path)}unexpected property "${key}"`);
		}
	}

	// Required keys must be present (and not undefined).
	for (const key of required) {
		if (!(key in obj) || obj[key] === undefined) {
			errors.push(`${at(path)}missing required property "${key}"`);
		}
	}

	// Type-check each provided known property.
	for (const [key, sub] of Object.entries(properties)) {
		if (key in obj && obj[key] !== undefined) {
			const childPath = path ? `${path}.${key}` : key;
			checkValue(sub, obj[key], childPath, errors);
		}
	}

	return obj;
}

/** Validate an array value, recursively checking each item against items schema. */
function checkArray(schema: Schema, value: unknown, path: string, errors: string[]): unknown {
	if (!Array.isArray(value)) {
		errors.push(`${at(path)}expected array, got ${kindOf(value)}`);
		return value;
	}
	const items = schema.items as Schema | undefined;
	if (items) {
		value.forEach((item, i) => {
			checkValue(items, item, `${path}[${i}]`, errors);
		});
	}
	return value;
}
