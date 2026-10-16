/** Shared route policy; contains no server credentials or Node-only imports. */
export const MODEL_PATHS=['/api/metadata','/api/agent','/api/market-research','/api/valuation/propose'] as const;
export const ANALYSIS_PATHS=[...MODEL_PATHS,'/api/extract','/api/regulatory-data','/api/presentation'] as const;
export const HANDOFF_HEADER='X-GPI-Handoff';
