/**
 * Knuth–Plass style item model (plan §4.1).
 *
 * A paragraph is a flat list of items. Widths are in points and come from the
 * host (InDesign measurements in production, font metrics in the simulator).
 * The paragraph end is implicit: the solver always breaks after the last item.
 */

/**
 * Hyphenation quality class (plan §5.3).
 * A: main joint, both sources agree. B: secondary point, both agree.
 * C: only the authority accepts it, or the word is ambiguous. X: vetoed.
 */
export type HyphenClass = 'A' | 'B' | 'C' | 'X';

/** Unbreakable fragment: a word, or the part of a word between break points. */
export interface Box {
  type: 'box';
  width: number;
  /** Visible text of the fragment. Used for reporting and text-level rules. */
  text?: string;
  /** Normalised word this fragment belongs to (lower case, no punctuation). */
  wordKey?: string;
  /** True on the first fragment of a word. */
  wordStart?: boolean;
  /** True on the last fragment of a word. */
  wordEnd?: boolean;
  /**
   * Extra width when the fragment is tracked. InDesign breaks ligatures (Th, fl, ft…) in tracked
   * text, and the separate letters are wider: a tracked "The" in Minion Pro 12 pt is 1 pt wider than
   * its untracked advance plus the tracking (measured 2026-10-17).
   */
  trackedExtra?: number;
}

/** Inter-word space. Fixed width: ragged text does not stretch spaces. */
export interface Glue {
  type: 'glue';
  width: number;
  /** Non-breaking space or otherwise protected: never a break point. */
  noBreak?: boolean;
  /** Extra cost for breaking here (Sinneinheiten, plan §2A.6). */
  breakCost?: number;
  /** Why breaking here costs extra, for violation reports. */
  breakReason?: string;
}

/** A possible break that is not a space: a hyphenation point, or a forced break. */
export interface Penalty {
  type: 'penalty';
  /** Width added at the line end when breaking here (the hyphen glyph). */
  width: number;
  /** The line visibly ends with a hyphen when breaking here. */
  flagged: boolean;
  /**
   * Quality class of a discretionary hyphenation point. Absent for breaks
   * after an existing hyphen, slash or dash, which do not count towards the
   * hyphenation budget but do count towards consecutive hyphenated lines.
   */
  quality?: HyphenClass;
  /** Mandatory break (forced line break inside the paragraph). */
  forced?: boolean;
  /** Extra cost for breaking here, on top of the class cost. */
  cost?: number;
  reason?: string;
}

export type Item = Box | Glue | Penalty;

export const box = (width: number, text?: string): Box =>
  text === undefined ? { type: 'box', width } : { type: 'box', width, text };

export const glue = (width: number, opts: Omit<Glue, 'type' | 'width'> = {}): Glue => ({
  type: 'glue',
  width,
  ...opts,
});
