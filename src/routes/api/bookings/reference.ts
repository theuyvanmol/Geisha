// Human-quotable booking reference (ResDiary parity).
//
// The implementation moved to $lib/bookings/reference so the ADMIN can compute the
// same code in the browser. It used to live here, server-only, behind node:crypto —
// which is why the diary quietly grew a second, cheaper reference of its own and a
// guest quoting the code from their email could not be found in search.
//
// Re-exported rather than relocated outright: this path is the one the booking API
// and the email layer already import, and the indirection costs nothing.
export { bookingReference } from '$lib/bookings/reference';
