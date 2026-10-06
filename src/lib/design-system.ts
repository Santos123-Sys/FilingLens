export const filingLensTheme = {
  shell: "bg-[#070c16] text-slate-100",
  surface: "border border-slate-800/90 bg-[#0d1525]/90",
  surfaceRaised: "border border-slate-700/70 bg-[#111c30]/95 shadow-xl shadow-slate-950/20",
  inset: "border border-slate-800/80 bg-slate-950/35",
  label: "text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500",
  muted: "text-slate-400",
  accentText: "text-cyan-300",
  focusRing: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070c16]",
  chart: {
    blue: "#60a5fa",
    cyan: "#22d3ee",
    green: "#34d399",
    amber: "#fbbf24",
    rose: "#fb7185",
    violet: "#a78bfa",
    grid: "#1e293b",
    axis: "#94a3b8",
  },
} as const;

export type QualityTone = "good" | "partial" | "bad" | "neutral";

export function qualityClasses(tone: QualityTone) {
  if (tone === "good") return "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200";
  if (tone === "partial") return "border-amber-500/30 bg-amber-500/[0.07] text-amber-200";
  if (tone === "bad") return "border-rose-500/30 bg-rose-500/[0.07] text-rose-200";
  return "border-slate-700 bg-slate-900/60 text-slate-400";
}
