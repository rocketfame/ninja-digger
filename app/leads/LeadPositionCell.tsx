"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const SPARKLINE_WIDTH = 80;
const SPARKLINE_HEIGHT = 28;

const MODAL_PADDING = { top: 20, right: 20, bottom: 40, left: 45 };
const MODAL_CHART_W = 600;
const MODAL_CHART_H = 320;
const PLOT_W = MODAL_CHART_W - MODAL_PADDING.left - MODAL_PADDING.right;
const PLOT_H = MODAL_CHART_H - MODAL_PADDING.top - MODAL_PADDING.bottom;

type Point = { date: string; position: number };

function sparklinePath(points: Point[], w: number, h: number): string {
  if (points.length === 0) return "";
  const maxP = Math.max(100, ...points.map((p) => p.position));
  const pad = 2;
  const xScale = points.length <= 1 ? 0 : (w - 2 * pad) / (points.length - 1);
  const y = (p: number) => pad + (h - 2 * pad) * ((p - 1) / (maxP - 1 || 1));
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${pad + i * xScale} ${y(p.position)}`).join(" ");
}

function positionOnDate(points: Point[], date: string | null): number | null {
  if (!date || points.length === 0) return null;
  return points.find((p) => p.date === date)?.position ?? null;
}

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

export function LeadPositionCell({
  points,
  firstSeen,
  artistName,
  artistBeatportId,
}: {
  points: Point[];
  firstSeen: string | null;
  artistName: string | null;
  artistBeatportId: string;
}) {
  const [open, setOpen] = useState(false);

  const path = useMemo(() => sparklinePath(points, SPARKLINE_WIDTH, SPARKLINE_HEIGHT), [points]);
  const positionAtFirstSeen = useMemo(() => positionOnDate(points, firstSeen), [points, firstSeen]);
  const latestPosition = points.length > 0 ? points[points.length - 1].position : null;
  const latestDate = points.length > 0 ? points[points.length - 1].date : null;

  const trend = useMemo(() => {
    if (points.length < 2) return { delta: 0, direction: "flat" as const };
    const prev = points[points.length - 2].position;
    const curr = points[points.length - 1].position;
    const delta = prev - curr;
    if (delta > 0) return { delta, direction: "up" as const };
    if (delta < 0) return { delta: Math.abs(delta), direction: "down" as const };
    return { delta: 0, direction: "flat" as const };
  }, [points]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  if (points.length === 0) {
    return <td className="px-2 py-1.5 text-[var(--text-muted)]">—</td>;
  }

  const mountEl = typeof document !== "undefined" ? document.body : null;

  return (
    <>
      <td className="w-[90px] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--bg-card)] px-1.5 py-0.5 hover:bg-[var(--bg-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          title={
            latestDate && latestPosition != null
              ? `#${latestPosition} (${formatShortDate(latestDate)})`
              : "Графік позиції"
          }
        >
          <svg width={SPARKLINE_WIDTH} height={SPARKLINE_HEIGHT} className="overflow-visible" aria-hidden>
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {latestPosition != null && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums">
              <span className="text-[var(--text-muted)]">#{latestPosition}</span>
              {trend.direction === "up" && (
                <span className="text-[#4ade80]" title={`+${trend.delta}`}>↑</span>
              )}
              {trend.direction === "down" && (
                <span className="text-[#f87171]" title={`-${trend.delta}`}>↓</span>
              )}
            </span>
          )}
        </button>
      </td>

      {open && mountEl && createPortal(
        <PositionChartModal
          artistName={artistName ?? artistBeatportId}
          points={points}
          firstSeen={firstSeen}
          positionAtFirstSeen={positionAtFirstSeen}
          onClose={close}
        />,
        mountEl
      )}
    </>
  );
}

function niceYTicks(min: number, max: number, count: number): number[] {
  const range = max - min || 1;
  const step = Math.max(1, Math.ceil(range / count));
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
}

function PositionChartModal({
  artistName,
  points,
  firstSeen,
  positionAtFirstSeen,
  onClose,
}: {
  artistName: string;
  points: Point[];
  firstSeen: string | null;
  positionAtFirstSeen: number | null;
  onClose: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const minPos = Math.min(...points.map((p) => p.position));
  const maxPos = Math.max(...points.map((p) => p.position));
  const yMin = Math.max(1, minPos - 2);
  const yMax = maxPos + 2;
  const yRange = yMax - yMin || 1;

  const xScale = points.length <= 1 ? 0 : PLOT_W / (points.length - 1);
  const toX = (i: number) => MODAL_PADDING.left + i * xScale;
  const toY = (pos: number) => MODAL_PADDING.top + PLOT_H * ((pos - yMin) / yRange);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(p.position)}`).join(" ");

  const yTicks = niceYTicks(yMin, yMax, 6);

  const xLabelCount = Math.min(points.length, Math.floor(PLOT_W / 50));
  const xStep = Math.max(1, Math.floor(points.length / xLabelCount));
  const xLabels: { idx: number; label: string }[] = [];
  for (let i = 0; i < points.length; i += xStep) {
    xLabels.push({ idx: i, label: formatShortDate(points[i].date) });
  }
  if (points.length > 1 && xLabels[xLabels.length - 1].idx !== points.length - 1) {
    xLabels.push({ idx: points.length - 1, label: formatShortDate(points[points.length - 1].date) });
  }

  const firstSeenIdx = firstSeen ? points.findIndex((p) => p.date === firstSeen) : -1;

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left - MODAL_PADDING.left;
      if (mx < 0 || mx > PLOT_W || points.length === 0) {
        setHoverIdx(null);
        return;
      }
      const idx = Math.round(mx / (xScale || 1));
      setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
    },
    [points.length, xScale]
  );

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-content max-h-[90vh] w-full max-w-[660px] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="truncate text-sm font-semibold text-[var(--text)]" title={artistName}>
            {artistName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        {/* Hover info */}
        <div className="mb-2 flex items-center gap-4 text-xs text-[var(--text-muted)]" style={{ minHeight: 18 }}>
          {hoverPoint ? (
            <>
              <span>{hoverPoint.date}</span>
              <span className="font-semibold text-[var(--text)]">#{hoverPoint.position}</span>
            </>
          ) : (
            <span>
              {points[0]?.date} — {points[points.length - 1]?.date} · {points.length} днів
            </span>
          )}
        </div>

        <svg
          width={MODAL_CHART_W}
          height={MODAL_CHART_H}
          className="mx-auto block select-none overflow-visible rounded border border-[var(--border)] bg-[var(--bg-page)]"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Y-axis grid + labels */}
          {yTicks.map((v) => {
            const y = toY(v);
            return (
              <g key={`y-${v}`}>
                <line
                  x1={MODAL_PADDING.left}
                  y1={y}
                  x2={MODAL_CHART_W - MODAL_PADDING.right}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                />
                <text
                  x={MODAL_PADDING.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="inherit"
                >
                  #{v}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {xLabels.map(({ idx, label }) => (
            <text
              key={`x-${idx}`}
              x={toX(idx)}
              y={MODAL_CHART_H - MODAL_PADDING.bottom + 18}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="inherit"
            >
              {label}
            </text>
          ))}

          {/* First seen vertical line */}
          {firstSeenIdx >= 0 && (
            <line
              x1={toX(firstSeenIdx)}
              y1={MODAL_PADDING.top}
              x2={toX(firstSeenIdx)}
              y2={MODAL_PADDING.top + PLOT_H}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.5"
            />
          )}

          {/* Chart line */}
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data point dots */}
          {points.length <= 60 &&
            points.map((p, i) => (
              <circle key={i} cx={toX(i)} cy={toY(p.position)} r={2} fill="var(--accent)" opacity="0.6" />
            ))}

          {/* Hover crosshair + dot */}
          {hoverIdx != null && hoverPoint && (
            <g>
              <line
                x1={toX(hoverIdx)}
                y1={MODAL_PADDING.top}
                x2={toX(hoverIdx)}
                y2={MODAL_PADDING.top + PLOT_H}
                stroke="var(--text-muted)"
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />
              <circle cx={toX(hoverIdx)} cy={toY(hoverPoint.position)} r={4} fill="var(--accent)" stroke="var(--bg-card)" strokeWidth="2" />
            </g>
          )}
        </svg>

        {/* First seen hint */}
        {firstSeen && positionAtFirstSeen != null && (
          <div
            className="mt-3 rounded border-l-[3px] border-[var(--accent)] bg-[var(--bg-page)] px-3 py-2 text-xs text-[var(--text-muted)]"
          >
            Перша поява <strong className="text-[var(--accent)]">#{positionAtFirstSeen}</strong> · {firstSeen}
          </div>
        )}
      </div>
    </div>
  );
}
