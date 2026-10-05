import { useMemo, useState } from 'react';
import type { EvidenceReference, FilingAnalysis } from '@contracts/analysis';
import { computeFinancialMetrics } from '@contracts/financial-metrics';

type Lang = 'en' | 'pt';
type Tab = 'overview' | 'financials' | 'market' | 'risks' | 'events';

const tabs: Array<{ key: Tab; en: string; pt: string }> = [
  { key: 'overview', en: 'Overview', pt: 'Visão geral' },
  { key: 'financials', en: 'Financials', pt: 'Financeiro' },
  { key: 'market', en: 'Market', pt: 'Mercado' },
  { key: 'risks', en: 'Risks', pt: 'Riscos' },
  { key: 'events', en: 'Events', pt: 'Eventos' },
];

function fmt(value: number | null | undefined, locale: string, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}
function sourceLabel(source?: EvidenceReference | null) {
  if (!source) return null;
  return [source.publisher, source.section, source.page, source.url].filter(Boolean).join(' · ');
}
function latest(values?: number[] | null) { return Array.isArray(values) && values.length ? values.at(-1) ?? null : null; }

export default function Dashboard({ data, lang }: { data: FilingAnalysis; lang: Lang }) {
  const [tab, setTab] = useState<Tab>('overview');
  const locale = data.jurisdiction === 'br' ? 'pt-BR' : 'en-US';
  const t = lang === 'pt';
  const metrics = useMemo(() => data.financials.computed?.length ? data.financials.computed : computeFinancialMetrics(data.financials), [data.financials]);
  const years = data.financials.years;
  const revenue = data.financials.revenue;
  const netIncome = data.financials.netIncome;
  const maxRevenue = Math.max(1, ...revenue.map(v => Math.abs(v)));
  const externalPeers = (data.market.peerEvidence ?? []).filter(p => p.sourceType === 'external');

  return (
    <section className="dashboard-print overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/80 shadow-2xl shadow-slate-950/30">
      <div className="border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/40 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-cyan-300">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1">{data.jurisdiction === 'br' ? 'CVM · Brasil' : 'SEC · United States'}</span>
              <span className="rounded-full border border-slate-600 px-2 py-1 text-slate-400">{data.company.filingType}</span>
              {data.company.periodEnd && <span className="rounded-full border border-slate-600 px-2 py-1 text-slate-400">{data.company.periodEnd}</span>}
            </div>
            <h2 className="text-2xl font-semibold text-white sm:text-3xl">{data.company.name}</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">{data.company.description}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{t ? 'Cobertura' : 'Coverage'}</div>
            <div className="mt-1 text-sm font-semibold text-emerald-300">{Object.values(data.diagnostics ?? {}).filter(d => d?.status === 'complete').length}/7 {t ? 'módulos' : 'modules'}</div>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950/50 px-3 py-2" aria-label="Dashboard sections">
        {tabs.map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition ${tab === item.key ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>{t ? item.pt : item.en}</button>)}
      </nav>

      <div className="p-5 sm:p-7">
        {tab === 'overview' && <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.kpis.slice(0, 8).map((kpi, i) => <article key={`${kpi.label}-${i}`} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{kpi.label}</div>
              <div className="mt-2 text-xl font-semibold text-white">{kpi.value}</div>
              {kpi.delta && <div className={`mt-1 text-xs ${kpi.positive === true ? 'text-emerald-300' : kpi.positive === false ? 'text-rose-300' : 'text-slate-400'}`}>{kpi.delta}</div>}
              {sourceLabel(kpi.source) && <div className="mt-2 line-clamp-2 text-[10px] text-slate-600">{sourceLabel(kpi.source)}</div>}
            </article>)}
          </div>
          <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-5">
            <h3 className="text-sm font-semibold text-cyan-200">{t ? 'Resumo executivo' : 'Executive summary'}</h3>
            <ul className="mt-3 grid gap-2 md:grid-cols-2">{data.summary.map((item, i) => <li key={i} className="rounded-lg bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">{item}</li>)}</ul>
          </article>
          {(data.missingData.length > 0 || data.confidenceNotes.length > 0) && <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><h3 className="text-sm font-semibold text-amber-200">{t ? 'Dados ausentes' : 'Missing data'}</h3><ul className="mt-2 space-y-1 text-xs text-amber-100/75">{data.missingData.map((x,i)=><li key={i}>• {x}</li>)}</ul></article>
            <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-4"><h3 className="text-sm font-semibold text-slate-200">{t ? 'Confiança' : 'Confidence'}</h3><div className="mt-2 space-y-2">{data.confidenceNotes.slice(0,6).map((x,i)=><div key={i} className="text-xs text-slate-400"><span className="mr-2 rounded bg-slate-800 px-2 py-0.5 uppercase text-cyan-300">{x.confidence}</span>{x.claim}</div>)}</div></article>
          </div>}
        </div>}

        {tab === 'financials' && <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[['Revenue', latest(revenue), ''], ['Net income', latest(netIncome), ''], ['EBITDA', latest(data.financials.ebitda), ''], ['Net debt / EBITDA', latest(metrics.find(m=>m.key==='netDebtToEbitda')?.values as number[] | undefined), 'x']].map(([label,value,suffix],i)=><article key={i} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold text-white">{fmt(value as number|null, locale, suffix as string)}</div><div className="mt-1 text-xs text-slate-500">{data.financials.unit}</div></article>)}
          </div>
          {years.length > 0 && <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-5"><h3 className="text-sm font-semibold text-cyan-200">{t ? 'Receita por período' : 'Revenue by period'}</h3><div className="mt-5 space-y-3">{years.map((year,i)=><div key={year} className="grid grid-cols-[88px_1fr_110px] items-center gap-3 text-xs"><span className="text-slate-400">{year}</span><div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{width:`${Math.max(2,Math.abs(revenue[i]??0)/maxRevenue*100)}%`}} /></div><span className="text-right text-slate-300">{fmt(revenue[i],locale)}</span></div>)}</div></article>}
          <article className="overflow-x-auto rounded-xl border border-slate-700"><table className="w-full min-w-[620px] text-left text-xs"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="px-4 py-3">Metric</th>{years.map(y=><th key={y} className="px-4 py-3 text-right">{y}</th>)}</tr></thead><tbody>{metrics.slice(0,14).map(metric=><tr key={metric.key} className="border-t border-slate-800"><td className="px-4 py-3 text-slate-300">{metric.key.replace(/([A-Z])/g,' $1')}</td>{metric.values.map((v,i)=><td key={i} className="px-4 py-3 text-right text-slate-400">{fmt(v,locale,metric.unit==='percent'?'%':metric.unit==='multiple'?'x':'')}</td>)}</tr>)}</tbody></table></article>
        </div>}

        {tab === 'market' && <div className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-5"><h3 className="text-sm font-semibold text-cyan-200">{data.market.industry || (t?'Setor não identificado':'Industry not identified')}</h3><div className="mt-4 flex flex-wrap gap-2">{(data.market.peerEvidence ?? []).map((peer,i)=><div key={`${peer.name}-${i}`} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"><div className="flex items-center gap-2 text-sm text-slate-200">{peer.name}<span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${peer.sourceType==='external'?'bg-violet-500/15 text-violet-300':'bg-cyan-500/15 text-cyan-300'}`}>{peer.sourceType==='external'?'WEB':'FILING'}</span></div>{peer.source.url && <div className="mt-1 max-w-[260px] truncate text-[10px] text-slate-600">{peer.source.url}</div>}</div>)}</div>{!data.market.competitors.length&&<p className="mt-4 text-sm text-slate-500">{t?'Nenhum concorrente verificável foi encontrado.':'No verified competitors were found.'}</p>}</article>
          <article className="rounded-xl border border-slate-700 bg-slate-950/40 p-5"><h3 className="text-sm font-semibold text-cyan-200">{t?'Mix operacional':'Operating mix'}</h3><div className="mt-3 space-y-3">{data.market.segments.slice(0,8).map((s,i)=><div key={i} className="rounded-lg bg-slate-900/70 p-3"><div className="font-medium text-slate-200">{s.name}</div><div className="mt-1 text-xs text-slate-500">{(s.periods??years).at(-1) ?? ''} · {fmt(latest(s.revenue),locale)}</div></div>)}{!data.market.segments.length&&data.market.geographies.slice(0,8).map((g,i)=><div key={i} className="rounded-lg bg-slate-900/70 p-3"><div className="font-medium text-slate-200">{g.name}</div><div className="mt-1 text-xs text-slate-500">{fmt(latest(g.values),locale)}</div></div>)}</div></article>
          {externalPeers.length>0 && <div className="lg:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-xs leading-5 text-violet-200">{t?'Os pares marcados WEB foram adicionados em uma etapa de pesquisa separada e só são exibidos quando a URL retornou como citação verificável.':'Peers tagged WEB were added in a separate research stage and are displayed only when the provider returned a verifiable citation URL.'}</div>}
        </div>}

        {tab === 'risks' && <div className="grid gap-3 md:grid-cols-2">{[...data.risks].sort((a,b)=>(a.materialityRank??99)-(b.materialityRank??99)).map((risk,i)=><article key={i} className="rounded-xl border border-slate-700 bg-slate-950/45 p-4"><div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-wider text-slate-500">{risk.category}</span><span className="rounded-full bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">{risk.severity}/5</span></div><h3 className="mt-2 font-semibold text-slate-100">{risk.title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{risk.summary}</p>{sourceLabel(risk.source)&&<div className="mt-2 text-[10px] text-slate-600">{sourceLabel(risk.source)}</div>}</article>)}</div>}

        {tab === 'events' && <div className="space-y-3">{data.events.map((event,i)=><article key={event.id??i} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-950/45 p-4 sm:grid-cols-[120px_1fr]"><div><div className="text-sm font-semibold text-cyan-300">{event.date}</div><div className="mt-1 text-[10px] uppercase text-slate-600">{event.category}</div></div><div><h3 className="font-medium text-slate-200">{event.title}</h3>{event.impact&&<p className="mt-1 text-sm text-slate-400">{event.impact}</p>}{sourceLabel(event.source)&&<div className="mt-2 text-[10px] text-slate-600">{sourceLabel(event.source)}</div>}</div></article>)}{!data.events.length&&<p className="text-sm text-slate-500">{t?'Nenhum evento validado no documento.':'No validated events in the filing.'}</p>}</div>}
      </div>
    </section>
  );
}
