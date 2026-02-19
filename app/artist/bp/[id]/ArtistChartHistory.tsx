"use client";

import { useMemo, useState, useRef, useCallback } from "react";

type ChartPoint = {
  date: string;
  position: number;
  track: string;
  genre: string;
};

type Props = {
  data: ChartPoint[];
  artistName: string;
};

const TRACK_PALETTE = [
  { stroke: "#60a5fa", fill: "rgba(96,165,250,0.12)", dot: "#93c5fd" },
  { stroke: "#a78bfa", fill: "rgba(167,139,250,0.12)", dot: "#c4b5fd" },
  { stroke: "#34d399", fill: "rgba(52,211,153,0.12)", dot: "#6ee7b7" },
  { stroke: "#fbbf24", fill: "rgba(251,191,36,0.12)", dot: "#fcd34d" },
  { stroke: "#f97316", fill: "rgba(249,115,22,0.12)", dot: "#fdba74" },
  { stroke: "#f472b6", fill: "rgba(244,114,182,0.12)", dot: "#f9a8d4" },
  { stroke: "#22d3ee", fill: "rgba(34,211,238,0.12)", dot: "#67e8f9" },
  { stroke: "#e879f9", fill: "rgba(232,121,249,0.12)", dot: "#f0abfc" },
];

const GENRE_BADGE_COLORS: Record<string, string> = {
  "afro-house": "#4ade80", "house": "#60a5fa", "techno": "#f87171",
  "melodic-house-techno": "#818cf8", "tech-house": "#fb923c",
  "minimal-deep-tech": "#a78bfa", "organic-house-downtempo": "#34d399",
  "progressive-house": "#22d3ee", "trance": "#e879f9",
  "funky-house": "#fbbf24", "nu-disco-disco": "#f472b6",
  "global": "#94a3b8", "indie-dance": "#c084fc",
  "hard-dance-hardcore-neo-rave": "#ef4444", "drum-and-bass": "#f97316",
  "dubstep": "#a855f7", "downtempo": "#2dd4bf",
  "electronica": "#38bdf8", "electro-classic-detroit-modern": "#e2e8f0",
  "ambient-experimental": "#cbd5e1",
};

function shortTrack(t: string): string {
  return t
    .replace(/\s*\(Original Mix\)\s*$/i, "")
    .replace(/\s*\(Extended Mix\)\s*$/i, "")
    .replace(/\s*\(Extended\)\s*$/i, "")
    .trim();
}

export function ArtistChartHistory({ data, artistName }: Props) {
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; point: ChartPoint; trackIdx: number } | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { tracks, genres, dateRange, grouped } = useMemo(() => {
    if (!data.length) return { tracks: [] as string[], genres: [] as string[], dateRange: [] as string[], grouped: new Map<string, Map<string, ChartPoint[]>>() };

    const trackSet = new Map<string, number>();
    const genreSet = new Set<string>();
    const dateSet = new Set<string>();

    for (const p of data) {
      genreSet.add(p.genre);
      dateSet.add(p.date);
      const short = shortTrack(p.track);
      trackSet.set(short, (trackSet.get(short) ?? 0) + 1);
    }

    const tracks = [...trackSet.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const genres = [...genreSet].sort();
    const dateRange = [...dateSet].sort();

    const grouped = new Map<string, Map<string, ChartPoint[]>>();
    for (const p of data) {
      const short = shortTrack(p.track);
      if (!grouped.has(short)) grouped.set(short, new Map());
      const byDate = grouped.get(short)!;
      if (!byDate.has(p.date)) byDate.set(p.date, []);
      byDate.get(p.date)!.push(p);
    }

    return { tracks, genres, dateRange, grouped };
  }, [data]);

  const filteredTracks = useMemo(() => {
    if (!selectedGenre) return tracks;
    return tracks.filter((t) => {
      const byDate = grouped.get(t);
      if (!byDate) return false;
      for (const points of byDate.values()) {
        if (points.some((p) => p.genre === selectedGenre)) return true;
      }
      return false;
    });
  }, [tracks, selectedGenre, grouped]);

  const W = 800;
  const H = 400;
  const PAD = { top: 24, right: 24, bottom: 44, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const { minPos, maxPos } = useMemo(() => {
    let lo = Infinity, hi = 0;
    for (const p of data) {
      if (p.position < lo) lo = p.position;
      if (p.position > hi) hi = p.position;
    }
    if (lo === Infinity) lo = 1;
    const range = hi - lo;
    const padding = Math.max(Math.ceil(range * 0.15), 3);
    return {
      minPos: Math.max(1, lo - padding),
      maxPos: hi + padding,
    };
  }, [data]);

  const xScale = useCallback((date: string) => {
    if (dateRange.length <= 1) return PAD.left + chartW / 2;
    const idx = dateRange.indexOf(date);
    return PAD.left + (idx / (dateRange.length - 1)) * chartW;
  }, [dateRange, chartW]);

  const yScale = useCallback((pos: number) => {
    if (maxPos === minPos) return PAD.top + chartH / 2;
    return PAD.top + ((pos - minPos) / (maxPos - minPos)) * chartH;
  }, [minPos, maxPos, chartH]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closest: { dist: number; x: number; y: number; point: ChartPoint; trackIdx: number } | null = null;
    for (let ti = 0; ti < filteredTracks.length; ti++) {
      const t = filteredTracks[ti];
      const byDate = grouped.get(t);
      if (!byDate) continue;
      for (const [d, points] of byDate) {
        const best = selectedGenre ? points.find((p) => p.genre === selectedGenre) : points[0];
        if (!best) continue;
        const px = xScale(d);
        const py = yScale(best.position);
        const dist = Math.hypot(mx - px, my - py);
        if (dist < 30 && (!closest || dist < closest.dist)) {
          closest = { dist, x: px, y: py, point: best, trackIdx: ti };
        }
      }
    }
    setHoveredPoint(closest);
  }, [filteredTracks, grouped, selectedGenre, xScale, yScale]);

  if (!data.length) {
    return (
      <section className="border-b border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
        Немає даних для побудови графіку
      </section>
    );
  }

  const tickDates = dateRange.length <= 10
    ? dateRange
    : dateRange.filter((_, i) => i === 0 || i === dateRange.length - 1 || i % Math.ceil(dateRange.length / 8) === 0);

  const positionTicks: number[] = [];
  const range = maxPos - minPos;
  const step = range <= 8 ? 1 : range <= 20 ? 2 : range <= 50 ? 5 : range <= 100 ? 10 : 20;
  const firstTick = Math.ceil(minPos / step) * step;
  for (let p = firstTick; p <= maxPos; p += step) positionTicks.push(p);
  if (positionTicks.length === 0 || positionTicks[0] > minPos + step) positionTicks.unshift(minPos);
  if (positionTicks[positionTicks.length - 1] < maxPos - step) positionTicks.push(maxPos);

  return (
    <section className="border-b border-[var(--border)]">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Історія в чартах
        </h3>
        <span className="text-[10px] text-[var(--text-muted)]">
          {filteredTracks.length} {filteredTracks.length === 1 ? "трек" : "треків"} · {dateRange.length} днів
        </span>
      </div>

      {/* Genre filter pills */}
      {genres.length > 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedGenre(null)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-all border"
            style={{
              backgroundColor: !selectedGenre ? "rgba(148,163,184,0.15)" : "transparent",
              color: !selectedGenre ? "#e2e8f0" : "var(--text-muted)",
              borderColor: !selectedGenre ? "rgba(148,163,184,0.3)" : "var(--border)",
            }}
          >
            Всі жанри
          </button>
          {genres.map((g) => {
            const isActive = selectedGenre === g;
            const color = GENRE_BADGE_COLORS[g] ?? "#94a3b8";
            return (
              <button
                key={g}
                type="button"
                onClick={() => setSelectedGenre(isActive ? null : g)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-all border"
                style={{
                  backgroundColor: isActive ? color + "20" : "transparent",
                  color: isActive ? color : "var(--text-muted)",
                  borderColor: isActive ? color + "40" : "var(--border)",
                }}
              >
                {g}
              </button>
            );
          })}
        </div>
      )}

      {/* SVG Chart */}
      <div className="px-4 pb-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-page)] p-2 overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <defs>
              {filteredTracks.slice(0, TRACK_PALETTE.length).map((_, i) => (
                <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TRACK_PALETTE[i % TRACK_PALETTE.length].stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={TRACK_PALETTE[i % TRACK_PALETTE.length].stroke} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            {/* Grid lines */}
            {positionTicks.map((p) => (
              <g key={`grid-${p}`}>
                <line
                  x1={PAD.left} y1={yScale(p)}
                  x2={W - PAD.right} y2={yScale(p)}
                  stroke="var(--border)" strokeWidth={0.5} strokeDasharray="4,3"
                />
                <text
                  x={PAD.left - 8} y={yScale(p) + 4}
                  textAnchor="end" fontSize={11} fill="var(--text-muted)" fontFamily="system-ui"
                >
                  #{p}
                </text>
              </g>
            ))}

            {/* Date labels */}
            {tickDates.map((d) => (
              <text
                key={d} x={xScale(d)} y={H - 8}
                textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="system-ui"
              >
                {d.slice(5).replace("-", ".")}
              </text>
            ))}

            {/* Track lines */}
            {filteredTracks.slice(0, TRACK_PALETTE.length).map((trackName, ti) => {
              const palette = TRACK_PALETTE[ti % TRACK_PALETTE.length];
              const byDate = grouped.get(trackName);
              if (!byDate) return null;

              const sortedDates = [...byDate.keys()].sort();
              const points = sortedDates.map((d) => {
                const pts = byDate.get(d)!;
                const best = selectedGenre ? pts.find((p) => p.genre === selectedGenre) : pts[0];
                return best ? { x: xScale(d), y: yScale(best.position), point: best } : null;
              }).filter(Boolean) as { x: number; y: number; point: ChartPoint }[];

              if (points.length === 0) return null;

              const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
              const bottomY = PAD.top + chartH;
              const areaPath = linePath + `L${points[points.length - 1].x},${bottomY}L${points[0].x},${bottomY}Z`;

              return (
                <g key={trackName} style={{ opacity: hoveredPoint && hoveredPoint.trackIdx !== ti ? 0.2 : 1, transition: "opacity 0.15s" }}>
                  <path d={areaPath} fill={`url(#grad-${ti})`} />
                  <path
                    d={linePath}
                    fill="none" stroke={palette.stroke} strokeWidth={2.5}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                  {points.map((p, pi) => (
                    <circle
                      key={pi} cx={p.x} cy={p.y} r={4}
                      fill={palette.dot} stroke={palette.stroke} strokeWidth={1.5}
                    />
                  ))}
                </g>
              );
            })}

            {/* Hover tooltip */}
            {hoveredPoint && (() => {
              const { x, y, point, trackIdx } = hoveredPoint;
              const palette = TRACK_PALETTE[trackIdx % TRACK_PALETTE.length];
              const tooltipW = 240;
              const tooltipH = 58;
              let tx = x + 12;
              let ty = y - tooltipH - 8;
              if (tx + tooltipW > W - 10) tx = x - tooltipW - 12;
              if (ty < 5) ty = y + 12;
              return (
                <g>
                  <circle cx={x} cy={y} r={6} fill={palette.stroke} fillOpacity={0.3} />
                  <circle cx={x} cy={y} r={3.5} fill={palette.dot} stroke="#fff" strokeWidth={1.5} />
                  <rect
                    x={tx} y={ty} width={tooltipW} height={tooltipH} rx={8}
                    fill="rgba(15,23,42,0.92)" stroke={palette.stroke} strokeWidth={1}
                  />
                  <text x={tx + 10} y={ty + 19} fontSize={12} fontWeight={700} fill={palette.dot} fontFamily="system-ui">
                    #{point.position} · {point.date.slice(5).replace("-", ".")}
                  </text>
                  <text x={tx + 10} y={ty + 36} fontSize={11} fill="#e2e8f0" fontFamily="system-ui">
                    {shortTrack(point.track).slice(0, 30)}
                  </text>
                  <text x={tx + 10} y={ty + 50} fontSize={10} fill="#94a3b8" fontFamily="system-ui">
                    {point.genre}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      </div>

      {/* Track legend */}
      {filteredTracks.length > 1 && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1">
          {filteredTracks.slice(0, TRACK_PALETTE.length).map((t, i) => (
            <div key={t} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: TRACK_PALETTE[i % TRACK_PALETTE.length].stroke }}
              />
              <span className="text-[10px] text-[var(--text-muted)] leading-tight max-w-[200px] truncate">
                {t}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
