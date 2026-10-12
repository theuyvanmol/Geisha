// Brevo (formerly Sendinblue) transactional email.
//
// Docs: https://developers.brevo.com/reference/sendtransacemail
//
// One POST to /v3/smtp/email with an `api-key` header. No SDK — same house style
// as the Resend transport beside it, and one fewer dependency to keep current.
//
// WHY BREVO ALONGSIDE RESEND
// --------------------------
// Resend was wired up first and still works. The client's mail is being moved to
// Brevo, so send.ts now prefers whichever provider is configured, Brevo first.
// Keeping both means the changeover is a key swap, not a deploy — and if Brevo's
// domain authentication isn't finished on the day, deleting the Brevo key puts
// confirmations back on Resend instantly.
//
// SENDER ADDRESS: Brevo will accept the API call and then FAIL the send if the
// From domain isn't authenticated on the account. That failure is asynchronous
// and shows up in Brevo's log, not in our response — so a 201 here is "accepted",
// not "delivered". See the DNS steps in the changeover notes.

/** Brevo's transactional endpoint. */
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface BrevoMessage {
	to: string;
	subject: string;
	html: string;
	/** text/plain alternative — see EmailMessage.text in send.ts for why it matters. */
	text?: string;
	/** RFC-ish "Name <addr>" or a bare address. */
	from: string;
	replyTo?: string;
	/** Brevo template/tag names, for filtering in their dashboard. */
	tags?: string[];
}

/** Split "Name <addr@host>" into Brevo's { name, email } shape. A bare address
 *  yields just an email, which Brevo accepts. */
export function parseAddress(value: string): { email: string; name?: string } {
	const m = value.trim().match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
	if (m) {
		const name = m[1].replace(/^["']|["']$/g, '').trim();
		return name ? { email: m[2].trim(), name } : { email: m[2].trim() };
	}
	return { email: value.trim() };
}

export interface BrevoResult {
	sent: boolean;
	id?: string;
	/** Populated on failure, for the log — never surfaced to a guest. */
	error?: string;
}

/**
 * Send one transactional email through Brevo.
 *
 * Never throws: the caller treats email as best-effort, because a booking must
 * not fail because a confirmation bounced. Returns { sent:false, error } instead.
 */
export async function sendViaBrevo(msg: BrevoMessage, apiKey: string): Promise<BrevoResult> {
	try {
		const res = await fetch(BREVO_ENDPOINT, {
			method: 'POST',
			headers: {
				'api-key': apiKey,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({
				sender: parseAddress(msg.from),
				to: [{ email: msg.to }],
				subject: msg.subject,
				htmlContent: msg.html,
				...(msg.text ? { textContent: msg.text } : {}),
				...(msg.replyTo ? { replyTo: parseAddress(msg.replyTo) } : {}),
				...(msg.tags?.length ? { tags: msg.tags } : {})
			})
		});

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return { sent: false, error: `Brevo ${res.status}: ${body}` };
		}
		const data = (await res.json().catch(() => ({}))) as { messageId?: string };
		return { sent: true, id: data.messageId };
	} catch (err) {
		return { sent: false, error: err instanceof Error ? err.message : String(err) };
	}
}
