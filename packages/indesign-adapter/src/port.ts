/**
 * The boundary between the apply loop and InDesign. The loop (apply.ts) only
 * talks to this interface: dom-port.ts implements it with the InDesign DOM, and
 * the tests implement it with a small greedy composer.
 */
import type { BandSpec, LineSlot, ToothSpec } from './geometry.ts';
import type { LanguageRun } from './languages.ts';

export interface ParagraphData {
  /** Index of the paragraph in the story. */
  index: number;
  /** Characters without the final paragraph return. */
  chars: string[];
  /** Advance width of each character in points. */
  advances: number[];
  /** Advances with ligatures broken up, as InDesign sets tracked text (same length; optional). */
  trackedAdvances?: number[];
  /** InDesign language name, e.g. "German: 2006 Reform": the one most of the paragraph's letters carry. */
  language: string;
  /** Language runs (paragraph-relative), only when the paragraph uses more than one language. */
  languages?: LanguageRun[];
  hyphenWidth: number;
  size: number;
  leading: number;
  /** Available width for the lines: column width minus left and right indents. */
  measure: number;
  /** InDesign's Hyphenation switch for the paragraph (undefined when unknown). */
  hyphenation?: boolean;
  /** The column width `measure` is based on (the story's first column); other columns differ by their own width. */
  columnWidth?: number;
  firstLineIndent: number;
  /** Content the port found Flatter cannot plan around (shown in the report; no compatibility alarm). */
  unsupported?: string[];
}

export interface ReadLine {
  paragraph: number;
  /** Line number within its paragraph. */
  line: number;
  /** Paragraph-relative index of the last visible character (trailing spaces ignored). */
  lastVisible: number;
  /** The line ends inside a word (InDesign hyphenated there). */
  hyphenated: boolean;
  slot: LineSlot;
}

export interface Port {
  paragraphs(): ParagraphData[];
  /**
   * InDesign's hyphenation points per word (S3 probing), or undefined when probing is unavailable. The words are
   * probed in `language` when given (words set in another language than the paragraph), else in the paragraph's.
   */
  probe(words: readonly string[], paragraph: ParagraphData, language?: string): Map<string, number[]> | undefined;
  /** Lines visible in the story's frames (overset lines have no position and are left out). */
  readLines(): ReadLine[];
  /** The story continues beyond its last frame. */
  overset(): boolean;
  /** Replace this story's teeth with these. */
  setTeeth(teeth: readonly ToothSpec[]): void;
  /**
   * Tracking rescue (ADR-010): set tracking on these character spans of a paragraph, relative to the
   * paragraph's base tracking, and reset every other character of the paragraph to the base.
   */
  setTracking(paragraph: number, spans: readonly TrackingSpan[]): void;
  /** Optional: the paragraph's lines came back wrong, so its tracking is read and written again next time. */
  forgetTracking?(paragraph: number): void;
  /** Show the Flatterzone and band behind the text (an empty list removes them). Optional. */
  setBands?(bands: readonly BandSpec[]): void;
}

export interface TrackingSpan {
  /** Paragraph-relative character range [from, to). */
  from: number;
  to: number;
  /** Tracking in 1/1000 em added to the base. */
  units: number;
}
