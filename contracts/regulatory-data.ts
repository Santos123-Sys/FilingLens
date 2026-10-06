import type { Jurisdiction } from "./analysis";

export type RegulatoryDataMetric = {
  key: string;
  value: number | null;
  unit?: string | null;
  period?: string | null;
  status: "verified" | "single_source" | "conflict" | "missing";
  source?: RegulatoryDataSource | null;
  rawLabel?: string | null;
  rawCode?: string | null;
};

export type RegulatoryDataSource = {
  provider: string;
  sourceType: string;
  url: string;
  retrievedAt: string;
  form?: string | null;
  period?: string | null;
};

export type RegulatoryDataSnapshot = {
  status: "complete" | "partial" | "unavailable" | "identifier_missing" | "not_applicable";
  jurisdiction: Jurisdiction;
  provider: string;
  company: Record<string, unknown>;
  metrics: RegulatoryDataMetric[];
  sources: RegulatoryDataSource[];
  warnings: string[];
  raw: Record<string, unknown>;
};

export type FilingAnalysisWithRegulatoryData<T> = T & {
  regulatoryData?: RegulatoryDataSnapshot;
};
