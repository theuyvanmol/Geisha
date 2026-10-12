// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { StaffSession } from '$lib/server/auth/staff';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The authenticated staff member for this request, or null. Populated
			 *  in hooks.server.ts via loadStaffFromCookie(). */
			staff: StaffSession | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
