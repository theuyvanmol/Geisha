// Words and reports around the booking widget's card step. Pure, so they're tested
// without a browser; EmbedBookingWidget does the wiring.

type DepositKind = 'deposit' | 'noshow_hold' | 'none';

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

/**
 * The details step's submit button. When the booking needs money it says so — the
 * amount used to appear first on the card screen, after the guest had typed their
 * name, email and phone, which is the worst moment to learn it. Kept short so it
 * never wraps: the details step has to fit the 820px frame without scrolling.
 */
export function submitLabel(
	option: { depositKind: DepositKind; depositPence: number } | null
): string {
	if (option && option.depositPence > 0) {
		if (option.depositKind === 'deposit')
			return `Continue to ${money(option.depositPence)} deposit`;
		if (option.depositKind === 'noshow_hold') return 'Continue to card details';
	}
	return 'Complete booking';
}

export interface CardStepState {
	/** The card form finished loading. */
	cardReady: boolean;
	/** How long it took to load, from the card step appearing; null if it never did. */
	readyMs: number | null;
	/** Times the guest pressed Pay. */
	payPresses: number;
	/** A confirm (incl. 3-D Secure) was in flight when they left. */
	paying: boolean;
}

/**
 * What to report when a guest leaves the card step without paying. Before this, a
 * guest who never saw the form, one who saw it and left, and one who went off to a
 * banking app and never came back all looked identical: an intent nobody touched.
 */
export function abandonReport(s: CardStepState): {
	stage: 'abandon';
	code: string;
	message: string;
} {
	const code = s.paying
		? 'left_during_payment'
		: s.cardReady
			? 'left_card_step'
			: 'left_before_card_form_loaded';
	const loaded =
		s.readyMs === null
			? 'card form never loaded'
			: `card form ready after ${(s.readyMs / 1000).toFixed(1)}s`;
	return { stage: 'abandon', code, message: `${loaded}; Pay pressed ${s.payPresses}` };
}
