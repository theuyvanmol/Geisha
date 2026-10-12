// WP-S6-7 — Voice V1: client-only Web Speech wrapper for the admin assistant.
//
// Two capabilities, both feature-detected and SSR-safe (every export is a
// graceful no-op when the API or `window` is absent):
//
//   · STT — press-and-hold dictation via SpeechRecognition (interimResults,
//     en-GB). startDictation(onInterim, onFinal) starts immediately and returns
//     a stop() fn; the dock wires it to pointerdown / pointerup so the host
//     speaks while holding and the transcript sends on release.
//   · TTS — speak(text) reads a reply back via speechSynthesis (en-GB). Always
//     cancels any in-flight utterance first so replies never stack during a
//     busy service. A mute toggle (voiceEnabled) is persisted in localStorage.
//
// SAFETY: this module only turns speech into text and text into speech. It never
// calls the API, never confirms a write, never auto-executes anything. The
// confirm-gate lives entirely in the dock / agent and is untouched here.
//
// Standalone-testable: importing this file has no side effects, and on a
// non-supporting runtime (Firefox, jsdom, SSR) isVoiceSupported() returns false
// and the rest no-op without throwing.

// --- Minimal Web Speech typings -------------------------------------------
// The SpeechRecognition family is non-standard and absent from the TS DOM lib,
// so we declare exactly the surface we use. These are ambient runtime shapes;
// we only ever touch them behind a feature-detection guard.

interface SpeechRecognitionAlternativeLike {
	readonly transcript: string;
}
interface SpeechRecognitionResultLike {
	readonly isFinal: boolean;
	readonly length: number;
	readonly [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
	readonly length: number;
	readonly [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
	readonly resultIndex: number;
	readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
	readonly error: string;
}
interface SpeechRecognitionLike {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	maxAlternatives: number;
	onresult: ((e: SpeechRecognitionEventLike) => void) | null;
	onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechCapableWindow {
	SpeechRecognition?: SpeechRecognitionCtor;
	webkitSpeechRecognition?: SpeechRecognitionCtor;
	speechSynthesis?: SpeechSynthesis;
	SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
	localStorage?: Storage;
}

const LANG = 'en-GB';
const MUTE_KEY = 'geisha.admin.voice.enabled';

/** The browser global, narrowed to the speech surface, or null on the server. */
function win(): SpeechCapableWindow | null {
	return typeof window === 'undefined' ? null : (window as unknown as SpeechCapableWindow);
}

function recognitionCtor(): SpeechRecognitionCtor | null {
	const w = win();
	return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

// --- Feature detection -----------------------------------------------------

/** True only when BOTH dictation and synthesis are usable in this runtime. */
export function isVoiceSupported(): boolean {
	const w = win();
	if (!w) return false;
	return !!recognitionCtor() && !!w.speechSynthesis && !!w.SpeechSynthesisUtterance;
}

/** Dictation alone (STT). Exposed so a UI can degrade independently if needed. */
export function isDictationSupported(): boolean {
	return !!recognitionCtor();
}

/** Synthesis alone (TTS readback). */
export function isSpeechSupported(): boolean {
	const w = win();
	return !!w?.speechSynthesis && !!w?.SpeechSynthesisUtterance;
}

// --- STT: press-and-hold dictation ----------------------------------------

/**
 * Start dictation immediately and return a stop() function. Intended for a
 * press-and-hold mic button: call on pointerdown, invoke the returned fn on
 * pointerup. `onInterim` fires live with the best in-progress transcript (feed
 * it into the draft); `onFinal` fires once with the settled transcript when the
 * engine ends (use it to send). On an unsupported runtime this is a no-op that
 * returns a no-op stop fn, so callers never need their own guard.
 */
export function startDictation(
	onInterim: (text: string) => void,
	onFinal: (text: string) => void
): () => void {
	const Ctor = recognitionCtor();
	if (!Ctor) return () => {};

	let rec: SpeechRecognitionLike | null = null;
	try {
		rec = new Ctor();
	} catch {
		return () => {};
	}

	rec.lang = LANG;
	rec.continuous = true; // keep listening for the whole hold
	rec.interimResults = true; // stream partials into the draft
	rec.maxAlternatives = 1;

	let finalText = '';
	let done = false;

	const finish = () => {
		if (done) return;
		done = true;
		try {
			rec?.stop();
		} catch {
			/* already stopped */
		}
		onFinal(finalText.trim());
	};

	rec.onresult = (e) => {
		let interim = '';
		for (let i = e.resultIndex; i < e.results.length; i++) {
			const result = e.results[i];
			const chunk = result[0]?.transcript ?? '';
			if (result.isFinal) finalText += chunk;
			else interim += chunk;
		}
		// Show the committed text plus whatever is still being recognised.
		onInterim((finalText + interim).trim());
	};

	rec.onerror = () => {
		// Permission denied / no-speech / network — settle gracefully with
		// whatever we captured rather than throwing into the UI.
		finish();
	};

	rec.onend = () => {
		finish();
	};

	try {
		rec.start();
	} catch {
		// Some engines throw if start() races a prior session; treat as a no-op.
		return () => {};
	}

	// The stop fn: ending recognition triggers onend → finish() → onFinal.
	return () => {
		try {
			rec?.stop();
		} catch {
			finish();
		}
	};
}

// --- TTS: spoken readback --------------------------------------------------

export interface SpeakOptions {
	/** 0.1–10, default 1. */ rate?: number;
	/** 0–2, default 1. */ pitch?: number;
	/** 0–1, default 1. */ volume?: number;
}

/**
 * Read `text` aloud (en-GB). Cancels any in-flight or queued utterance first so
 * replies never overlap. No-op when synthesis is unsupported, when muted via
 * the persisted toggle, or when given empty text. The CALLER is responsible for
 * passing only the human summary — never raw JSON or a DESTRUCTIVE prefix.
 */
export function speak(text: string, opts: SpeakOptions = {}): void {
	if (!isVoiceEnabled()) return;
	const w = win();
	if (!w?.speechSynthesis || !w.SpeechSynthesisUtterance) return;

	const clean = text.trim();
	if (!clean) return;

	try {
		w.speechSynthesis.cancel(); // never stack utterances
		const u = new w.SpeechSynthesisUtterance(clean);
		u.lang = LANG;
		u.rate = opts.rate ?? 1;
		u.pitch = opts.pitch ?? 1;
		u.volume = opts.volume ?? 1;
		w.speechSynthesis.speak(u);
	} catch {
		/* synthesis can throw on some platforms — fail silent */
	}
}

/** Stop any current/queued speech (e.g. when the user starts a new request). */
export function cancelSpeech(): void {
	const w = win();
	try {
		w?.speechSynthesis?.cancel();
	} catch {
		/* no-op */
	}
}

// --- Mute toggle (persisted) ----------------------------------------------
// Voice readback is opt-OUT but persisted: once a staff member mutes it, it
// stays muted across reloads so TTS never surprises them mid-service. Defaults
// to enabled (true) when nothing is stored. Dictation is unaffected by mute —
// muting only silences the spoken reply.

/** Current readback preference. Defaults to true; survives SSR (returns true). */
export function isVoiceEnabled(): boolean {
	const w = win();
	if (!w) return false; // never "enabled" on the server
	try {
		const stored = w.localStorage?.getItem(MUTE_KEY);
		return stored === null || stored === undefined ? true : stored === '1';
	} catch {
		return true;
	}
}

/** Persist the readback preference; cancels speech immediately when muting. */
export function setVoiceEnabled(enabled: boolean): void {
	const w = win();
	if (!w) return;
	try {
		w.localStorage?.setItem(MUTE_KEY, enabled ? '1' : '0');
	} catch {
		/* private mode / blocked storage — preference just won't persist */
	}
	if (!enabled) cancelSpeech();
}
