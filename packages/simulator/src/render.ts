/**
 * Renders plans to a standalone SVG: glyphs as paths (no font needed to view),
 * the long and short bands as tinted strips, and markers for violations.
 */
import type { Plan, Violation } from '@flatter/core';
import type { SimFont } from './font.ts';

export interface RenderOptions {
  font: SimFont;
  fontSize: number;
  leading: number;
  measure: number;
  showBands?: boolean;
  showMarkers?: boolean;
  /** Colours; defaults suit a white page. */
  colors?: Partial<RenderColors>;
}

export interface RenderColors {
  paper: string;
  ink: string;
  longBand: string;
  shortBand: string;
  edge: string;
  error: string;
  warning: string;
  note: string;
}

const DEFAULT_COLORS: RenderColors = {
  paper: '#ffffff',
  ink: '#1b1b1b',
  longBand: 'rgba(37, 99, 235, 0.12)',
  shortBand: 'rgba(234, 88, 12, 0.12)',
  edge: 'rgba(0, 0, 0, 0.25)',
  error: '#d1242f',
  warning: '#bf8700',
  note: '#6e7781',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSvg(plans: readonly Plan[], opts: RenderOptions): string {
  const c = { ...DEFAULT_COLORS, ...opts.colors };
  const { font, fontSize: size, leading, measure } = opts;
  const left = 24;
  const top = 24;
  const markerX = left + measure + 14;
  const width = left + measure + 60;
  const parts: string[] = [];
  let y = top;

  plans.forEach((plan, pi) => {
    if (pi > 0) y += leading;
    const blockTop = y;
    const blockHeight = plan.lines.length * leading;
    const P = plan.params;
    if (opts.showBands !== false && plan.lines.length > 0) {
      parts.push(
        `<rect x="${left + measure - P.band}" y="${blockTop}" width="${P.band}" height="${blockHeight}" fill="${c.longBand}"/>`,
        `<rect x="${left + measure - P.flatterzone - P.band}" y="${blockTop}" width="${P.band}" height="${blockHeight}" fill="${c.shortBand}"/>`,
      );
    }
    parts.push(`<line x1="${left + measure}" y1="${blockTop}" x2="${left + measure}" y2="${blockTop + blockHeight}" stroke="${c.edge}" stroke-width="0.5"/>`);

    const byLine = new Map<number, Violation[]>();
    for (const v of plan.violations) {
      if (v.line < 0) continue;
      byLine.set(v.line, [...(byLine.get(v.line) ?? []), v]);
    }

    for (const line of plan.lines) {
      const baseline = y + leading * 0.5 + size * font.xHeight * 0.5;
      const x = left + line.indent;
      parts.push(`<path d="${font.pathData(line.text, x, baseline, size)}" fill="${c.ink}"><title>${esc(line.text)}</title></path>`);
      const vs = byLine.get(line.index) ?? [];
      if (opts.showMarkers !== false) {
        const worst = vs.find((v) => v.severity === 'error') ?? vs.find((v) => v.severity === 'warning');
        if (worst) {
          const color = worst.severity === 'error' ? c.error : c.warning;
          const title = vs.map((v) => `${v.kind}: ${v.message}`).join('\n');
          parts.push(`<circle cx="${markerX}" cy="${baseline - size * font.xHeight * 0.5}" r="3" fill="${color}"><title>${esc(title)}</title></circle>`);
        }
        if (line.hyphenClass) {
          parts.push(
            `<text x="${markerX + 8}" y="${baseline}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${Math.max(6, size * 0.6)}" fill="${c.note}">${line.hyphenClass}</text>`,
          );
        }
      }
      y += leading;
    }
  });

  const height = y + top;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * 2}" height="${height * 2}">`,
    `<rect width="100%" height="100%" fill="${c.paper}"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}
