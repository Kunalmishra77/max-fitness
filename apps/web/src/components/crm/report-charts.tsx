'use client';

import { useId, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * The charts on the owner's reports (crm-module-spec §6; crm-ux-blueprint §13).
 *
 * Built to the data-viz method rather than by taste:
 * - **Form first.** Busy hours are columns (magnitude by hour), shown as two small
 *   multiples on one shared scale — weekdays and weekends — never two series on one
 *   plot. Plan mix and money by method are single-series bars. Men/women is the one
 *   two-series figure, so it is the one with a legend.
 * - **Colour by job.** One series takes one hue for every mark; the two-series split
 *   takes categorical slots 1 and 2, validated against the CRM's white surface (all
 *   six checks pass: CVD ΔE 24.7, normal-vision ΔE 33.6). The meter track is a lighter
 *   step of the same ramp. The CRM is light-only, so there is no dark set.
 * - **Marks.** Bars at most 24px thick with a 4px rounded data end, square at the
 *   baseline; a 2px surface gap between touching marks; hairline, solid, recessive grid.
 * - **Text never wears series colour**, and every value is readable without hovering:
 *   bars carry their value at the tip, the split carries it in the legend, and the
 *   column chart has a table twin behind one button.
 * - **Hover and focus show the same tooltip**, and the hit target is the whole slot,
 *   not the painted pixels. Labels arrive as plain strings and render as text.
 */

const VIZ: CSSProperties = {
  // Reference palette (dataviz palette.md): categorical slots 1–2 and the blue ramp.
  ['--series-1' as string]: '#2a78d6',
  ['--series-2' as string]: '#eb6834',
  ['--track' as string]: '#cde2fb',
  // CRM design tokens: hairline grid one step off white, muted and primary ink.
  ['--grid' as string]: '#EEF0F2',
  ['--muted' as string]: '#5C6272',
  ['--ink' as string]: '#0F1729',
};

// ── Tooltip ─────────────────────────────────────────────────────────────────

interface TipState {
  readonly left: number;
  readonly top: number;
  readonly value: string;
  readonly label: string;
}

/** One tooltip per figure: value first and strong, the label after it. */
function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);

  const showAt = (target: HTMLElement, container: HTMLElement | null, value: string, label: string, clientX?: number) => {
    if (container === null) return;
    const box = container.getBoundingClientRect();
    // The hit target is the whole slot, but the tooltip belongs just above the painted
    // mark: anchored to the slot it floated over the chart and covered the table button.
    const slot = target.getBoundingClientRect();
    const painted = (target.firstElementChild as HTMLElement | null)?.getBoundingClientRect() ?? slot;
    const left = (clientX ?? slot.left + slot.width / 2) - box.left;
    setTip({ left: Math.max(8, Math.min(left, box.width - 8)), top: painted.top - box.top, value, label });
  };

  const bind = (container: () => HTMLElement | null, value: string, label: string) => ({
    tabIndex: 0,
    'aria-label': `${label}: ${value}`,
    onPointerMove: (event: PointerEvent<HTMLElement>) => showAt(event.currentTarget, container(), value, label, event.clientX),
    onPointerLeave: () => setTip(null),
    onFocus: (event: FocusEvent<HTMLElement>) => showAt(event.currentTarget, container(), value, label),
    onBlur: () => setTip(null),
  });

  const layer: ReactNode =
    tip === null ? null : (
      <div
        role="status"
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-input bg-white px-3 py-2 text-small shadow-[var(--shadow-overlay)] ring-1 ring-black/10"
        style={{ left: tip.left, top: tip.top - 6 }}
      >
        <span className="block font-semibold text-[color:var(--ink)]">{tip.value}</span>
        <span className="block text-[color:var(--muted)]">{tip.label}</span>
      </div>
    );

  return { bind, layer };
}

// ── Busy hours: two small multiples on one scale ────────────────────────────

export interface BusyHourRow {
  readonly hour: number;
  readonly hourLabel: string;
  readonly weekday: number;
  readonly weekend: number;
  readonly weekdayText: string;
  readonly weekendText: string;
}

export function BusyHoursChart({
  rows,
  weekdayTitle,
  weekendTitle,
  tableHour,
  showTable,
  showChart,
}: {
  rows: readonly BusyHourRow[];
  weekdayTitle: string;
  weekendTitle: string;
  tableHour: string;
  showTable: string;
  showChart: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();

  // One scale for both panels, so the same height means the same crowd.
  const max = Math.max(...rows.map((row) => Math.max(row.weekday, row.weekend)), 0.1);

  return (
    <div style={VIZ}>
      <button
        type="button"
        onClick={() => setAsTable((value) => !value)}
        aria-controls={id}
        className="mb-3 min-h-11 rounded-button px-3 text-small font-semibold text-brand-wall-blue underline"
      >
        {asTable ? showChart : showTable}
      </button>

      <div id={id}>
        {asTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-small tabular-nums">
              <thead>
                <tr className="text-left text-[color:var(--muted)]">
                  <th className="py-1 pr-3 font-semibold">{tableHour}</th>
                  <th className="py-1 pr-3 font-semibold">{weekdayTitle}</th>
                  <th className="py-1 font-semibold">{weekendTitle}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.hour} className="border-t border-[color:var(--grid)]">
                    <td className="py-1 pr-3">{row.hourLabel}</td>
                    <td className="py-1 pr-3">{row.weekdayText}</td>
                    <td className="py-1">{row.weekendText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-5">
            <ColumnPanel title={weekdayTitle} rows={rows} pick="weekday" max={max} />
            <ColumnPanel title={weekendTitle} rows={rows} pick="weekend" max={max} />
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnPanel({ title, rows, pick, max }: { title: string; rows: readonly BusyHourRow[]; pick: 'weekday' | 'weekend'; max: number }) {
  const { bind, layer } = useTip();
  let container: HTMLDivElement | null = null;
  const PLOT = 112;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-small font-semibold text-[color:var(--ink)]">{title}</figcaption>
      <div
        ref={(node) => {
          container = node;
        }}
        className="relative"
      >
        {/* Two hairlines: the top of the scale and its middle. Solid, one step off the surface. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-[color:var(--grid)]" />
        <div className="pointer-events-none absolute inset-x-0 border-t border-[color:var(--grid)]" style={{ top: PLOT / 2 }} />

        {/* Above the hairlines: the grid is recessive and must never cut through a bar. */}
        <div className="relative z-[1] flex items-end gap-0.5" style={{ height: PLOT }} role="list">
          {rows.map((row) => {
            const value = row[pick];
            const text = pick === 'weekday' ? row.weekdayText : row.weekendText;
            return (
              <div
                key={row.hour}
                role="listitem"
                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand-wall-blue"
                {...bind(() => container, text, row.hourLabel)}
              >
                <span
                  aria-hidden
                  className="block w-full max-w-6 rounded-t-[4px] bg-[color:var(--series-1)]"
                  style={{ height: value === 0 ? 0 : Math.max(2, (value / max) * PLOT) }}
                />
              </div>
            );
          })}
        </div>

        {/* The baseline, then hour labels every third column so they never collide. */}
        <div className="border-t border-[color:var(--muted)]/40" />
        <div className="flex gap-0.5 pt-1">
          {rows.map((row, index) => (
            <span key={row.hour} aria-hidden className="min-w-0 flex-1 text-center text-[11px] leading-none tabular-nums text-[color:var(--muted)]">
              {index % 3 === 0 ? row.hour : ''}
            </span>
          ))}
        </div>
        {layer}
      </div>
    </figure>
  );
}

// ── Single-series bars, value at the tip ────────────────────────────────────

export interface ShareBarRow {
  readonly key: string;
  readonly label: string;
  /** 0–100: the bar's length as a share of the biggest row. */
  readonly length: number;
  readonly valueText: string;
}

export function ShareBars({ rows }: { rows: readonly ShareBarRow[] }) {
  const { bind, layer } = useTip();
  let container: HTMLUListElement | null = null;

  return (
    <div className="relative" style={VIZ}>
      <ul
        ref={(node) => {
          container = node;
        }}
        className="grid gap-3"
      >
        {rows.map((row) => (
          <li key={row.key} className="outline-none focus-visible:ring-2 focus-visible:ring-brand-wall-blue" {...bind(() => container, row.valueText, row.label)}>
            <span className="block text-small text-[color:var(--ink)]">{row.label}</span>
            <span className="mt-1 flex items-center gap-2">
              <span
                aria-hidden
                className="block h-4 rounded-r-[4px] bg-[color:var(--series-1)]"
                style={{ width: `${Math.max(row.length, row.length > 0 ? 2 : 0) * 0.72}%` }}
              />
              <span className="shrink-0 text-small font-semibold text-[color:var(--ink)]">{row.valueText}</span>
            </span>
          </li>
        ))}
      </ul>
      {layer}
    </div>
  );
}

// ── Two-series split, with its legend ───────────────────────────────────────

export interface SplitRow {
  readonly key: string;
  readonly label: string;
  readonly share: number;
  readonly valueText: string;
}

const SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--muted)'] as const;

export function SplitBar({ rows }: { rows: readonly SplitRow[] }) {
  const { bind, layer } = useTip();
  let container: HTMLDivElement | null = null;

  return (
    <div className="relative" style={VIZ}>
      <div
        ref={(node) => {
          container = node;
        }}
        className="flex h-4 gap-0.5"
      >
        {rows.map((row, index) => (
          <span
            key={row.key}
            className={`block h-full outline-none focus-visible:ring-2 focus-visible:ring-brand-wall-blue ${index === 0 ? 'rounded-l-[4px]' : ''} ${index === rows.length - 1 ? 'rounded-r-[4px]' : ''}`}
            style={{ width: `${row.share}%`, background: SLOTS[index] ?? SLOTS[2] }}
            {...bind(() => container, row.valueText, row.label)}
          />
        ))}
      </div>
      {/* The legend is the identity channel and the values: nothing rides on colour alone. */}
      <ul className="mt-3 grid gap-1">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2 text-small text-[color:var(--ink)]">
            <span aria-hidden className="inline-block size-3 rounded-[3px]" style={{ background: SLOTS[index] ?? SLOTS[2] }} />
            <span>{row.label}</span>
            <span className="ml-auto font-semibold">{row.valueText}</span>
          </li>
        ))}
      </ul>
      {layer}
    </div>
  );
}

// ── Meter ───────────────────────────────────────────────────────────────────

export function Meter({ percent, label }: { percent: number; label: string }) {
  return (
    <div style={VIZ}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
        className="h-2 w-full rounded-full bg-[color:var(--track)]"
      >
        <div className="h-full rounded-full bg-[color:var(--series-1)]" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
    </div>
  );
}
