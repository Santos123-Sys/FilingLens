import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveMarketSnapshot } from "../../api/value-driver-provider";
import { simulateValueDriverRisk, DEFAULT_RISK_RANGES } from "../../contracts/value-driver-risk";
import type { WatchSignal } from "../../api/value-driver-monitor";
import type { FilingAnalysis } from "../../contracts/analysis";
import { annualValueDriverSignals } from "../../contracts/value-driver-signals";
import {
  analyzeDrivers, reverseDcfGrowth, runDcf, scenario,
  type ValuationInputs, type DriverKey, type DriverSpec, DEFAULT_DRIVER_SPECS,
  type Uncertainty,
} from "../../contracts/value-driver-intelligence";
import { APPLE_2026_CASE, APPLE_ANALYST_ASSUMPTIONS } from "../data/apple-value-driver-case";

type Props = { lang?: "en" | "pt"; data?: FilingAnalysis };
type Anchor = { name: string; year: string; source: string | null; revenueBn: number; marginPct: number; netDebtBn: number | null; currency: string; warning: string | null; financialInstitution: boolean };
type Quote = { price: string; sharesBn: string; date: string; url: string };
const money = (v: number, currency: string) => `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const displayNum = (v: number) => Number.isFinite(v) ? v.toFixed(2) : "—";
const apple = APPLE_2026_CASE;
const DEFAULT_QUOTE: Quote = { price: "", sharesBn: "", date: "", url: "" };
const NUMBER_PATTERN = /\b(million|millions|milh[oõ]es|usd mm|brl mm|r\$ milh[oõ]es)\b/i;

function fromFiling(data: FilingAnalysis): Anchor | null {
  const f = data.financials;
  const hist = f.annualHistory;
  const annualForm = /10-k|20-f|\bdfp\b|annual/i.test(data.company.filingType);
  const series = hist ?? (annualForm ? f : null);
  if (!series || !NUMBER_PATTERN.test(series.unit || f.unit)) return null;
  const i = series.years.length - 1;
  const revenue = series.revenue[i], ebit = series.ebit?.[i];
  if (typeof revenue !== "number" || !Number.isFinite(revenue) || revenue <= 0 ||
      typeof ebit !== "number" || !Number.isFinite(ebit)) return null;
  const annualHistory = !!hist;
  const debt = annualHistory ? hist.totalDebt[i] : f.totalDebt?.[i];
  const cash = annualHistory ? hist.cash[i] : f.cash?.[i];
  const netDebt = typeof debt === "number" && typeof cash === "number" ? (debt - cash) / 1000 : null;
  const source = annualHistory ? (hist.sources.find(s => s.url)?.url ?? null) :
    (f.evidence?.find(e => /revenue|ebit|operatingIncome/i.test(e.metric) && e.source.url)?.source.url ?? null);
  const warn = netDebt !== null ? "Net debt uses disclosed interest-bearing debt less cash only; excess securities and other bridge items may be omitted." :
    "Missing verified debt/cash bridge: enterprise-value sensitivities only until completed.";
  return {
    name: data.company.name, year: series.years[i], source, revenueBn: revenue / 1000,
    marginPct: ebit / revenue * 100, netDebtBn: netDebt, currency: data.jurisdiction === "br" ? "BRL" : "USD",
    warning: warn, financialInstitution: /\b(bank|banco|banking|insurance|seguradora|insurer|reit)\b/i.test(data.market.industry),
  };
}
const sliderFields: { key: DriverKey; en: string; pt: string; min: number; max: number; step: number }[] = [
  { key: "growthPct", en: "Initial annual revenue growth", pt: "Crescimento inicial de receita", min: -5, max: 30, step: 0.5 },
  { key: "operatingMarginPct", en: "Sustainable operating margin", pt: "Margem operacional sustentável", min: 5, max: 55, step: 0.5 },
  { key: "cashTaxPct", en: "Modeled cash tax rate", pt: "Alíquota efetiva de caixa", min: 5, max: 40, step: 0.5 },
  { key: "reinvestmentPct", en: "Forecast reinvestment / NOPAT", pt: "Reinvestimento projetado / NOPAT", min: 0, max: 60, step: 1 },
  { key: "waccPct", en: "Weighted cost of capital", pt: "Custo médio de capital (WACC)", min: 4, max: 16, step: 0.25 },
  { key: "terminalGrowthPct", en: "Perpetual growth", pt: "Crescimento perpétuo", min: 0, max: 5, step: 0.25 },
  { key: "terminalRoicPct", en: "Terminal return on new capital", pt: "Retorno terminal sobre novo capital", min: 8, max: 40, step: 1 },
];
const CALL_OUT = "rounded-lg border border-slate-700 bg-slate-900/60 p-3";
const small = "text-xs leading-relaxed text-slate-400";
const label = "block text-xs font-semibold text-slate-300";
const field = "w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-white focus:border-cyan-400 focus:outline-none";
const uncertaintyKeys: Uncertainty[] = ["unrated", "low", "medium", "high"];

function observedEvForRisk(live:LiveMarketSnapshot|null,quote:Quote,netDebtBn:number|null,currency:string):number|null{
  // Do not treat a manual string or a stale, wrong-currency vendor quote as a probability target.
  if(netDebtBn===null||!live?.quote||live.quote.stale||live.quote.currency!==currency)return null;
  if(String(live.quote.price)!==quote.price)return null;
  return live.quote.marketCapBn+netDebtBn;
}

export default function ValueDriverIntelligence({ data, lang = "en" }: Props) {
  const pt = lang === "pt";
  const anchor = useMemo(() => data ? fromFiling(data) : null, [data]);
  const demo = !data;
  const signals = useMemo(() => data ? annualValueDriverSignals(data) : [], [data]);
  const inputsInitial: ValuationInputs = anchor ? {
    ...APPLE_ANALYST_ASSUMPTIONS, revenueBn: anchor.revenueBn,
    operatingMarginPct: anchor.marginPct, netDebtBn: anchor.netDebtBn ?? 0, sharesBn: 1,
  } : APPLE_ANALYST_ASSUMPTIONS;
  const [params, setParams] = useState<ValuationInputs>(inputsInitial);
  const [quote, setQuote] = useState<Quote>(demo
    ? { price: String(apple.market.closeUsd), sharesBn: String(apple.market.sharesBn), date: apple.market.asOf, url: apple.market.url }
    : DEFAULT_QUOTE);
  const [uncertainty, setUncertainty] = useState<Record<string, Uncertainty>>({});
  const [bridge, setBridge] = useState(anchor?.netDebtBn === null ? "" : String(anchor?.netDebtBn ?? APPLE_ANALYST_ASSUMPTIONS.netDebtBn));
  const [showProjection, setShowProjection] = useState(false);
  const [liveSnapshot,setLiveSnapshot] = useState<LiveMarketSnapshot|null>(null);
  const [liveState,setLiveState] = useState<"loading"|"ready"|"partial"|"unavailable">("loading");
  const [providerIssue,setProviderIssue] = useState<string|null>(null);
  // Personal research token is only held in React memory; never logged, persisted or added to URLs.
  const [personalAccessToken,setPersonalAccessToken] = useState("");
  const [watchSignals,setWatchSignals] = useState<WatchSignal[]>([]);
  const [monitorNote,setMonitorNote] = useState<string|null>(null);
  const [riskRanges,setRiskRanges] = useState<Record<string,number>>({});
  const [growthMarginCorrelation,setGrowthMarginCorrelation] = useState(0);
  const manualQuoteOverride = useRef(false);
  const marketSymbol = (data?.company.ticker ?? (demo ? apple.identity.ticker : "")).toUpperCase();
  const providerSymbol = marketSymbol && data?.jurisdiction === "br" && !marketSymbol.endsWith(".SA") ? marketSymbol + ".SA" : marketSymbol;
  const expectedCurrency = data?.jurisdiction === "br" ? "BRL" : "USD";
  useEffect(()=>{
    if(!providerSymbol || !/^[A-Z][A-Z0-9.-]{0,15}$/.test(providerSymbol)){
      setLiveState("unavailable");setProviderIssue("missing_company_ticker");return;
    }
    if(!personalAccessToken || personalAccessToken.length<32){
      setLiveState("unavailable");setProviderIssue("private_token_required");return;
    }
    let active=true;
    const headers={Authorization:`Bearer ${personalAccessToken}`};
    const refresh=async()=>{
      try{
        const response=await fetch(`/api/value-drivers/live/${encodeURIComponent(providerSymbol)}?currency=${expectedCurrency}`,{cache:"no-store",headers});
        const payload=await response.json() as LiveMarketSnapshot & {error?:string};
        if(!active)return;
        if(!response.ok){
          setLiveState("unavailable");setProviderIssue(payload.error??"market_provider_unavailable");return;
        }
        setLiveSnapshot(payload);setLiveState(payload.status);setProviderIssue(null);
        if(payload.quote&&!payload.quote.stale&&payload.quote.currency===expectedCurrency&&!manualQuoteOverride.current){
          setQuote({
            price:String(payload.quote.price),
            sharesBn:String(payload.quote.sharesBn),
            date:payload.quote.observedAt.slice(0,10),
            url:payload.quote.source,
          });
        }
        const monitored=await fetch(`/api/value-drivers/watch/${encodeURIComponent(providerSymbol)}`,{cache:"no-store",headers});
        if(!active)return;
        if(monitored.ok){
          const history=await monitored.json() as {signals?:WatchSignal[]};
          if(active){setWatchSignals(history.signals??[]);setMonitorNote(null);}
        }else if(active){
          const error=await monitored.json() as {error?:string};
          setMonitorNote(error.error??"monitor_unavailable");
        }
      }catch{
        if(active){setLiveState("unavailable");setProviderIssue("live_market_network_error");}
      }
    };
    void refresh();
    // Reduced to 30-minute foreground refresh; Yahoo endpoints are unofficial and may throttle.
    const ticker=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh();},1800000);
    return ()=>{active=false;window.clearInterval(ticker);};
  },[providerSymbol,expectedCurrency,personalAccessToken]);

  const current = data ? anchor : { name: apple.identity.name, year: apple.annual.period, source: apple.annual.url, revenueBn: apple.annual.revenueBn, marginPct: apple.annual.operatingMarginPct, netDebtBn: APPLE_ANALYST_ASSUMPTIONS.netDebtBn, currency: "USD", warning: apple.capitalBridge.limitation, financialInstitution: false };
  const bridgeNumber = bridge.trim() === "" ? null : Number(bridge);
  const price = quote.price.trim() && Number(quote.price) > 0 ? Number(quote.price) : null;
  const shares = quote.sharesBn.trim() && Number(quote.sharesBn) > 0 ? Number(quote.sharesBn) : null;
  const quoteValid = price !== null && shares !== null && !!/^\d{4}-\d{2}-\d{2}$/.exec(quote.date) &&
    /^https:\/\//i.test(quote.url) && bridgeNumber !== null && Number.isFinite(bridgeNumber);
  const p = { ...params, netDebtBn: bridgeNumber ?? 0, sharesBn: shares ?? 1 };
  const valuation = useMemo(() => { try { return { result: runDcf(p), error: null }; } catch (e) { return { result: null, error: (e as Error).message }; } }, [p.revenueBn, p.growthPct, p.operatingMarginPct, p.cashTaxPct, p.reinvestmentPct, p.waccPct, p.terminalGrowthPct, p.terminalRoicPct, p.netDebtBn, p.sharesBn, p.horizonYears]);
  const specs: DriverSpec[] = DEFAULT_DRIVER_SPECS.map(s => ({ ...s, uncertainty: uncertainty[s.key] ?? "unrated" }));
  const ranking = valuation.result ? analyzeDrivers(p, specs) : [];
  const ranges=DEFAULT_RISK_RANGES.map(d=>({...d,halfWidthPp:riskRanges[d.key]??d.halfWidthPp}));
  const risk=useMemo(()=>{
    if(!valuation.result)return null;
    try{return simulateValueDriverRisk(p,{
      distributions:ranges,draws:1000,seed:18267,
      observedEnterpriseValueBn:observedEvForRisk(liveSnapshot,quote,bridgeNumber,expectedCurrency),
      growthMarginCorrelation,
    });}catch{return null;}
  // Explicit dependency on analytic inputs, not every polling status or render.
  },[params,bridgeNumber,shares,riskRanges,growthMarginCorrelation,liveSnapshot,quote,valuation.result]);

  const observedEv = quoteValid ? price! * shares! + bridgeNumber! : null;
  const reverse = valuation.result ? reverseDcfGrowth(p, observedEv) : null;
  const scenarios = valuation.result ? [
    { name: pt ? "Baixa" : "Bear", changes: { growthPct: p.growthPct - 3, operatingMarginPct: p.operatingMarginPct - 3, waccPct: p.waccPct + 1 } },
    { name: pt ? "Base" : "Base", changes: {} },
    { name: pt ? "Alta" : "Bull", changes: { growthPct: p.growthPct + 3, operatingMarginPct: p.operatingMarginPct + 3, waccPct: p.waccPct - 1 } },
  ].map(x => { try { return { ...x, result: scenario(p, x.changes).enterpriseValueBn }; } catch { return { ...x, result: null }; } }) : [];
  const setParam = (key: DriverKey, value: number) => setParams(x => ({ ...x, [key]: value }));
  if (!current) return <section className={CALL_OUT} role="status">
    <h3 className="font-semibold text-cyan-200">{pt ? "Dados anuais insuficientes" : "Insufficient annual data"}</h3>
    <p className={small}>{pt ? "Requer receita e EBIT anuais identificados, com unidade em milhões. Não convertemos trimestres em anos implicitamente." : "Requires sourced annual revenue and operating income in millions. Quarterly/YTD data is not silently annualized."}</p>
    <a className="mt-2 inline-block text-sm text-cyan-300 underline" href="/value-drivers/apple">{pt ? "Ver estudo Apple" : "View the Apple case study"}</a>
  </section>;
  if (current.financialInstitution) return <section className={CALL_OUT} role="status">
    <h3 className="font-semibold text-amber-200">{pt ? "Modelo industrial inadequado" : "Industrial FCFF model inapplicable"}</h3>
    <p className={small}>{pt ? "Bancos, seguradoras e REITs precisam de modelos próprios de patrimônio/capital regulatório." : "Banks, insurers and REITs require sector-specific equity and regulatory capital valuation models."}</p>
  </section>;

  return <section className="space-y-5" aria-label="Value Driver Intelligence">
    <div className="rounded-xl border border-cyan-600/30 bg-cyan-950/20 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-white">{pt ? "Inteligência de Direcionadores de Valor" : "Value Driver Intelligence"}</h3><span className="rounded-full border border-cyan-500/30 px-2 py-1 text-[10px] font-bold text-cyan-200">{demo ? "APPLE SEC CASE • FROZEN SNAPSHOT" : "FILING-SOURCED / ANALYST INPUTS"}</span></div>
      <p className={small}>{pt ? "Demonstrações históricas são fatos; taxas, cenários e DCF são hipóteses editáveis, não guidance nem consenso de analistas." : "Historical filing facts are separate from analyst-selectable forecasts. DCF, scenarios and reverse DCF are NOT consensus estimates, company guidance or a stock-price prediction."}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={CALL_OUT}><div className={small}>{pt ? "Companhia" : "Company"}</div><strong className="text-white">{current.name}</strong></div>
        <div className={CALL_OUT}><div className={small}>{pt ? "Base anual" : "Annual base"}</div><strong className="text-white">{current.year}</strong></div>
        <div className={CALL_OUT}><div className={small}>{pt ? "Receita reportada" : "Reported revenue"}</div><strong className="text-white">{money(current.revenueBn, current.currency)}</strong></div>
        <div className={CALL_OUT}><div className={small}>{pt ? "Margem EBIT histórica" : "Historical EBIT margin"}</div><strong className="text-white">{current.marginPct.toFixed(1)}%</strong></div>
      </div>
      {current.source && <p className="mt-2 text-xs text-slate-400"><a href={current.source} rel="noopener noreferrer" target="_blank" className="text-cyan-300 underline">{pt ? "Fonte das demonstrações" : "Historical filing source"}</a></p>}
      {current.warning && <p className="mt-2 text-xs text-amber-200">{current.warning}</p>}
    </div>
    <article className={CALL_OUT} aria-label="External market data and monitoring">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{pt ? "Yahoo Finance — pesquisa pessoal (fechamentos diários)" : "Yahoo Finance — personal research (daily closes)"}</h4>
        <span className={liveState==="ready"?"text-xs text-emerald-300":"text-xs text-amber-300"}>{liveState} · {providerSymbol||"—"}</span>
      </div>
      <p className={small}>{pt ? "Consulta a cada cinco minutos, com horário de negociação e data de extração explícitos." : "Polls every five minutes while visible. Quote observation time and data retrieval time are different."}</p>
      <label className="mt-3 block text-xs text-slate-300">{pt?"Token privado de avaliação (somente em memória)":"Private valuation access token (in-memory only)"}
        <input type="password" value={personalAccessToken} autoComplete="off" spellCheck={false} onChange={e=>setPersonalAccessToken(e.target.value)} placeholder={pt?"Cole o token privado do Railway":"Paste private Railway valuation token"} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100" />
      </label>
      <p className="mt-1 text-xs text-slate-400">{pt?"Fonte Yahoo não oficial, somente uso pessoal; preço = último fechamento diário não ajustado, não cotação negociável em tempo real.":"Unofficial Yahoo source, personal use only; price = last unadjusted daily close, not an executable real-time quote."}</p>
      {providerIssue && <p role="status" className="mt-2 text-xs text-amber-300">{pt?"Fonte de dados atuais indisponível":"Live feed unavailable"}: {providerIssue}. {pt?"Os dados históricos não são cotação atual.":"Historical fixtures are not live quotes."}</p>}
      {liveSnapshot?.quote && <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className={CALL_OUT}><p className={small}>{pt?"Preço observado":"Observed quote"}</p><p className="text-lg font-semibold text-white">{liveSnapshot.quote.currency} {liveSnapshot.quote.price.toFixed(2)}</p><p className={small}>{liveSnapshot.quote.tradingDate??liveSnapshot.quote.observedAt.slice(0,10)} ({pt?"data da barra diária":"daily bar date"})</p></div>
        <div className={CALL_OUT}><p className={small}>{pt?"Capitalização fornecida":"Provider market cap"}</p><p className="text-lg font-semibold text-white">{money(liveSnapshot.quote.marketCapBn,liveSnapshot.quote.currency)}</p><p className={small}>{pt?"Ações implícitas, não reportadas":"Derived shares, not reported"}: {liveSnapshot.quote.sharesBn.toFixed(3)}B</p></div>
        <div className={CALL_OUT}><p className={small}>{liveSnapshot.quote.stale?(pt?"Preço desatualizado":"Stale quote"):(pt?"Horário validado":"Timestamp validated")}</p><p className={small}>{liveSnapshot.quote.ageMinutes} min · {pt?"Dados podem ter atraso contratual":"Provider delay depends on data plan"}</p>
          <button type="button" disabled={liveSnapshot.quote.stale||liveSnapshot.quote.currency!==expectedCurrency} className="mt-2 rounded bg-cyan-800 px-2 py-1 text-xs text-white disabled:opacity-40" onClick={()=>{
            const q=liveSnapshot.quote!;manualQuoteOverride.current=false;
            setQuote({price:String(q.price),sharesBn:String(q.sharesBn),date:q.observedAt.slice(0,10),url:q.source});
          }}>{pt?"Usar preço observado":"Use observed quote"}</button>
        </div>
      </div>}
      {!!liveSnapshot?.consensus.length && <div className="mt-3 overflow-x-auto">
        <h5 className="text-xs font-semibold text-slate-100">{pt?"Consenso anual do provedor":"Provider annual analyst consensus"}</h5>
        <p className={small}>{pt?"Obtido em":"Retrieved"} {liveSnapshot.consensusAsOf}; {pt?"a data fiscal é inferida e o EBIT consenso não está disponível no Yahoo.":"fiscal-year labels are inferred; Yahoo does not supply forward EBIT consensus."}</p>
        <table className="mt-2 w-full min-w-[500px] text-right text-xs text-slate-300"><thead><tr className="border-b border-slate-600"><th className="py-2 text-left">{pt?"Ano fiscal":"Fiscal end"}</th><th>{pt?"Receita (bi)":"Revenue (B)"}</th><th>EBIT (B)</th><th>EPS</th><th>{pt?"Analistas":"Analysts"} Rev/EPS</th></tr></thead><tbody>{liveSnapshot.consensus.map(y=><tr key={y.periodEnd} className="border-b border-slate-800"><td className="py-2 text-left">{y.periodEnd}</td><td>{y.revenueAvgBn?.toFixed(2)??"—"}</td><td>{y.ebitAvgBn?.toFixed(2)??"—"}</td><td>{y.epsAvg?.toFixed(2)??"—"}</td><td>{y.analystCountRevenue??"—"} / {y.analystCountEps??"—"}</td></tr>)}</tbody></table>
      </div>}
      {liveSnapshot?.consensusError && <p className="mt-2 text-xs text-amber-300">{pt?"Consenso indisponível":"Consensus unavailable"}: {liveSnapshot.consensusError}. {pt?"Nenhuma estimativa inventada.":"No inferred estimates."}</p>}
      <div className="mt-3 border-t border-slate-700 pt-2">
        <h5 className="text-xs font-semibold text-slate-200">{pt?"Sinais do monitoramento horário":"Hourly watch signals"}</h5>
        {watchSignals.length?<div className="mt-2 grid gap-2 md:grid-cols-2">{watchSignals.slice(0,8).map((signal,i)=><div key={i} className={CALL_OUT}><p className="text-xs font-semibold text-amber-200">{signal.type.replaceAll("_"," ")}: {signal.magnitudePct>=0?"+":""}{signal.magnitudePct.toFixed(2)}%</p><p className={small}>{signal.observedAt} · {signal.fiscalPeriodEnd??signal.symbol} · {pt?"Revisar":"Review required"}</p></div>)}</div>:<p className={small}>{monitorNote??(pt?"Sem alertas materiais registrados.":"No recorded material alerts.")}</p>}
        <p className={`mt-2 ${small}`}>{pt?"Coleta diária privada exige cron Railway ativo e acesso pessoal aos dados Yahoo. Sem e-mails ou notificações push.":"Private daily snapshots require Railway cron and permitted personal Yahoo data access. In-app signals only; no push or email."}</p>
      </div>
    </article>
    {demo && <div className="rounded-lg border border-amber-500/30 bg-amber-900/10 p-3 text-sm text-amber-100">
      <strong>{pt ? "Sinal de normalização:" : "Normalization watch:"}</strong>{" "}
      {pt ? "Margem bruta trimestral de 50,1% em FY2026 Q3 incluiu ~2 p.p. de reembolsos tarifários; não os capitalize automaticamente como recorrentes." : "FY2026 Q3 gross margin was 50.1%, including approximately 2 percentage points from tariff refunds. Do not mechanically extrapolate that temporary benefit."}{" "}
      <a href={apple.quarterly.url} target="_blank" rel="noopener noreferrer" className="underline text-cyan-300">SEC 10-Q</a>
    </div>}
    {demo && <article className={CALL_OUT}>
      <h4 className="mb-2 text-sm font-semibold text-white">{pt ? "Mapa causal — fatos trimestrais" : "Operating-driver evidence map — reported Q3 facts"}</h4>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={CALL_OUT}><strong className="text-white">iPhone {((apple.quarterly.iphoneSalesBn/44.582-1)*100).toFixed(1)}% YoY</strong><p className={small}>{pt ? "Vendas de iPhone sustentam receita. Pesquisar volumes, preços e ciclo de troca." : "Revenue exposure: test upgrade volumes, prices and replacement cycle."}</p></div>
        <div className={CALL_OUT}><strong className="text-white">Services {((apple.quarterly.servicesSalesBn/27.423-1)*100).toFixed(1)}% YoY</strong><p className={small}>{pt ? "Investigar persistência do crescimento, App Store e margens." : "Test recurring growth durability, App Store regulation, and mix-driven margins."}</p></div>
        <div className={CALL_OUT}><strong className="text-white">50.1% → ~48.1%</strong><p className={small}>{pt ? "Margem bruta trimestral reportada menos o efeito indicado de restituições tarifárias; aproximação, não guidance." : "Reported Q3 gross margin minus disclosed approximate tariff-refund benefit; not a management forecast."}</p></div>
      </div>
      <p className={`mt-2 ${small}`}><a href={apple.quarterly.url} className="text-cyan-300 underline" rel="noopener noreferrer" target="_blank">SEC FY2026 Q3 10-Q</a> · {pt ? "Drivers operacionais são hipóteses a investigar, não causalidade demonstrada." : "The research questions are causal hypotheses, not conclusions established by these figures."}</p>
    </article>}
    {signals.length > 0 && <article className={CALL_OUT}>
      <h4 className="mb-1 text-sm font-semibold text-white">{pt ? "Mudanças detectadas nos relatórios anuais" : "New-filing driver change signals"}</h4>
      <p className={small}>{pt ? "Comparações entre exercícios fornecidos, calculadas localmente; revisão ao analisar novo documento, sem monitoramento automático." : "Local comparisons of sourced annual periods; recalculated when a new filing is analyzed. No background polling or live alerts."}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{signals.map(signal => <div key={signal.metric} className="rounded-md border border-slate-700 p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><strong className="text-white">{signal.title}</strong><span className={signal.material ? "text-amber-300" : "text-slate-400"}>{signal.material ? (pt ? "Investigar" : "Review") : (pt ? "Acompanhar" : "Track")}</span></div>
        <p className="mt-1 text-slate-200">{signal.unit === "percentage_points" ? `${signal.delta >= 0 ? "+" : ""}${signal.delta.toFixed(2)} pp` : `${pct(signal.delta)} YoY`} · {signal.previousPeriod} → {signal.currentPeriod}</p>
        <p className={small}>{signal.interpretation}</p>
        {signal.evidenceUrl && <a href={signal.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 underline">{pt ? "Fonte" : "Filing source"}</a>}
      </div>)}</div>
    </article>}
    {demo && <article className={CALL_OUT}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-white">{pt ? "Consenso de analistas publicado" : "Archived Oct 2026 analyst-consensus baseline (not live)"}</h4>
        <span className="text-xs text-slate-400">{apple.consensus.asOf}</span>
      </div>
      <p className={small}>{pt ? "Previsões externas de curto prazo, não dados históricos auditados nem taxa implícita do DCF reverso." : "Actual external near-term analyst estimates, NOT audited historical facts or the reverse DCF's longer-horizon model-implied growth."}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={CALL_OUT}><p className={small}>FY2026 {pt ? "receita esperada" : "revenue estimate"}</p><strong className="text-white">{money(apple.consensus.fy2026RevenueBn, "USD")}</strong><p className={small}>+{apple.consensus.fy2026GrowthPct.toFixed(2)}% YoY</p></div>
        <div className={CALL_OUT}><p className={small}>FY2027 {pt ? "receita esperada" : "revenue estimate"}</p><strong className="text-white">{money(apple.consensus.fy2027RevenueBn, "USD")}</strong><p className={small}>+{apple.consensus.fy2027GrowthPct.toFixed(2)}% YoY</p></div>
        <div className={CALL_OUT}><p className={small}>FY2026 {pt ? "margem EBIT esperada" : "estimated EBIT margin"}</p><strong className="text-white">{apple.consensus.fy2026OperatingMarginPct.toFixed(2)}%</strong><p className={small}>EBIT {money(apple.consensus.fy2026OperatingIncomeBn, "USD")}</p></div>
        <div className={CALL_OUT}><p className={small}>{pt ? "Proveniência" : "Provenance"}</p><strong className="text-slate-200 text-xs">{apple.consensus.source}</strong></div>
      </div>
      <p className={small}>FY2026 EPS: USD {apple.consensus.fy2026EpsUsd.toFixed(2)} · {pt ? "FCL consensual" : "Forecast FCF"}: {money(apple.consensus.fy2026FreeCashFlowBn, "USD")} · {pt ? "Analistas" : "Analyst observations"}: {apple.consensus.analystCount}. {pt ? "Esses valores são estimativas, não resultados divulgados." : "Forecast values; not reported company results."}</p>
      <p className={`mt-2 ${small}`}><a className="text-cyan-300 underline" href={apple.consensus.url} target="_blank" rel="noopener noreferrer">{pt ? "Fonte dos analistas" : "Analyst estimate source"}</a> · <a className="text-cyan-300 underline" href={apple.consensus.corroborationUrl} target="_blank" rel="noopener noreferrer">{pt ? "Conferência independente" : "Corroborating estimates"}</a>. {pt ? "A taxa implícita do DCF reverso mantém hipóteses constantes ao longo de vários anos, logo não é diretamente comparável à previsão anual." : "Reverse DCF fixes the other assumptions across a multi-year horizon, so its implied growth rate cannot be directly equated to one annual consensus forecast."}</p>
    </article>}
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/30 p-4">
        <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-white">{pt ? "Hipóteses do modelo" : "Analyst forecast assumptions"}</h4><button type="button" className="text-xs text-cyan-300 underline" onClick={() => { setParams(inputsInitial); setBridge(anchor?.netDebtBn === null ? "" : String(anchor?.netDebtBn ?? APPLE_ANALYST_ASSUMPTIONS.netDebtBn)); }}>{pt ? "Restaurar" : "Reset"}</button></div>
        {sliderFields.map(f => <label key={f.key} className="block">
          <div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-slate-300">{pt ? f.pt : f.en}</span><strong className="text-white">{params[f.key].toFixed(f.step < 1 ? 2 : 0)}%</strong></div>
          <input type="range" className="w-full accent-cyan-400" min={f.min} max={f.max} step={f.step} value={params[f.key]} onChange={e => setParam(f.key, Number(e.target.value))}/>
        </label>)}
        <p className={small}>{pt ? "Crescimento inicial na primeira metade de 10 anos; convergência ao crescimento terminal nos anos restantes. Fluxo ao acionista = valor empresarial − dívida líquida." : "Growth holds during the first half of the 10-year forecast and fades thereafter. Terminal reinvestment is tied to terminal growth / terminal ROIC; explicit-year reinvestment is a separate scenario assumption."}</p>
        {valuation.error && <p role="alert" className="rounded-md border border-rose-500/40 p-2 text-sm text-rose-200">{valuation.error}</p>}
      </div>
      <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-800/30 p-4">
        <h4 className="font-semibold text-white">{pt ? "Preço de mercado e estrutura de capital" : "Market observation and equity bridge"}</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>{pt ? "Fechamento (moeda/ação)" : "Share close (currency/share)"}<input className={field} type="number" min="0.01" step="0.01" value={quote.price} onChange={e=>{manualQuoteOverride.current=true;setQuote(x=>({...x,price:e.target.value}));}}/></label>
          <label className={label}>{pt ? "Ações (bilhões)" : "Shares (billions)"}<input className={field} type="number" min="0.001" step="0.001" value={quote.sharesBn} onChange={e=>{manualQuoteOverride.current=true;setQuote(x=>({...x,sharesBn:e.target.value}));}}/></label>
          <label className={label}>{pt ? "Data do preço" : "Market close date"}<input className={field} type="date" value={quote.date} onChange={e=>{manualQuoteOverride.current=true;setQuote(x=>({...x,date:e.target.value}));}}/></label>
          <label className={label}>{pt ? "Dívida líquida (bilhões)" : "Net debt (billions)"}<input className={field} type="number" step="0.001" placeholder="Required; negative = net cash" value={bridge} onChange={e=>setBridge(e.target.value)}/></label>
        </div>
        <label className={label}>{pt ? "URL da cotação (obrigatória)" : "Public quote source URL (required)"}<input className={field} type="url" value={quote.url} placeholder="https://..." onChange={e=>{manualQuoteOverride.current=true;setQuote(x=>({...x,url:e.target.value}));}}/></label>
        <p className={small}>{pt ? "Cotação fornecida manualmente; nenhum feed ao vivo. Dívida líquida negativa significa caixa líquido. Somente quote datada com fonte libera reverse DCF." : "Manual, dated market snapshot; no live-price feed. Negative net debt indicates net cash. Reverse DCF is disabled until price, shares, dated source and debt bridge are provided."}</p>
        {demo && <p className={small}>{pt ? "Dados Apple" : "Apple real-data inputs"}: <a target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline" href={apple.market.url}>2026-10-09 quote</a> · <a target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline" href={apple.capitalBridge.url}>2026-06-27 SEC balance sheet</a>. {pt ? "Dados com datas diferentes." : "Different observation dates."}</p>}
        {valuation.result && <div className="grid grid-cols-2 gap-3">
          <div className={CALL_OUT}><p className={small}>{pt ? "Valor empresarial modelado" : "Modeled enterprise value"}</p><strong className="text-lg text-white">{money(valuation.result.enterpriseValueBn, current.currency)}</strong></div>
          <div className={CALL_OUT}><p className={small}>{pt ? "Peso do valor terminal" : "PV of terminal value"}</p><strong className="text-lg text-white">{valuation.result.terminalSharePct.toFixed(1)}%</strong></div>
          <div className={CALL_OUT}><p className={small}>{pt ? "Preço justo hipotético" : "Modeled value / share"}</p><strong className="text-lg text-white">{shares && bridgeNumber !== null ? `${current.currency} ${displayNum(valuation.result.impliedSharePrice)}` : "—"}</strong></div>
          <div className={CALL_OUT}><p className={small}>{pt ? "EV observado, derivado" : "Observed implied EV"}</p><strong className="text-lg text-white">{observedEv !== null ? money(observedEv, current.currency) : "—"}</strong></div>
        </div>}
      </div>
    </div>
    {valuation.result && <>
      <div className="grid gap-4 md:grid-cols-2">
        <article className={CALL_OUT}><h4 className="mb-2 text-sm font-semibold text-white">{pt ? "Reverse DCF: expectativa implícita" : "Reverse DCF: market-implied growth"}</h4>
          <p className="text-2xl font-bold text-cyan-200">{reverse?.impliedGrowthPct === null || reverse?.impliedGrowthPct === undefined ? "—" : `${reverse.impliedGrowthPct.toFixed(2)}%`}</p>
          <p className={small}>{reverse?.explanation ?? "Unavailable"}</p>
          {observedEv !== null && <p className="mt-2 text-xs text-slate-400">{pt ? "Variação versus base" : "Difference vs analyst assumption"}: {reverse?.impliedGrowthPct == null ? "—" : `${(reverse.impliedGrowthPct - params.growthPct).toFixed(2)} pp`}</p>}
        </article>
        <article className={CALL_OUT}><h4 className="mb-2 text-sm font-semibold text-white">{pt ? "Cenários conjuntos" : "Joint-parameter scenarios"}</h4>
          <div className="space-y-2">{scenarios.map(s => <div key={s.name} className="flex justify-between gap-3 border-b border-slate-700 pb-1 text-sm"><span className="text-slate-300">{s.name}</span><strong className="text-white">{s.result === null ? "Not valid" : money(s.result, current.currency)}</strong></div>)}</div>
          <p className={`mt-2 ${small}`}>{pt ? "Baixa/alta: crescimento ±3 p.p., margem ±3 p.p. e WACC ∓1 p.p. Não são probabilidades." : "Bear/bull: growth ±3pp, margin ±3pp, WACC ∓1pp. Scenarios are assumptions, not probability-weighted forecasts."}</p>
        </article>
      </div>
      <article className={CALL_OUT} aria-label="Probabilistic value driver analysis">
        <h4 className="text-base font-semibold text-white">{pt?"Análise probabilística condicional de risco":"Scenario-conditional probabilistic risk analysis"}</h4>
        <p className={`mt-1 ${small}`}>{pt?"Monte Carlo determinístico com mil sorteios triangulares e semente fixa. Amplitudes são hipóteses modificáveis, não estimativas estatísticas de mercado. P10/P50/P90 e frequências NÃO são probabilidades empiricamente calibradas.":"Deterministic 1,000-draw seeded triangular Monte Carlo. Analyst-defined ranges, NOT fitted historical volatility or calibrated real-world probabilities. P10/P50/P90 and event frequencies are strictly conditional on these choices."}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className={CALL_OUT}><p className={small}>P10 {pt?"EV":"enterprise value"}</p><strong className="text-lg text-white">{risk?money(risk.p10EvBn,current.currency):"—"}</strong></div>
          <div className={CALL_OUT}><p className={small}>P50 EV</p><strong className="text-lg text-white">{risk?money(risk.p50EvBn,current.currency):"—"}</strong></div>
          <div className={CALL_OUT}><p className={small}>P90 EV</p><strong className="text-lg text-white">{risk?money(risk.p90EvBn,current.currency):"—"}</strong></div>
        </div>
        {risk && <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div className={CALL_OUT}><p className={small}>{pt?"Amostras válidas / rejeitadas":"Accepted / rejected samples"}</p><strong className="text-sm text-white">{risk.accepted} / {risk.rejected}</strong><p className={small}>{pt?"Amostras rejeitadas não são substituídas por zero":"Invalid perpetuities are rejected, never replaced with zeros"}.</p></div>
          <div className={CALL_OUT}><p className={small}>{pt?"Fração de cenários com valor inferior ao EV observado":"Simulated fraction below observed EV"}</p><strong className="text-lg text-white">{risk.probabilityBelowObservedEV===null?"—":(risk.probabilityBelowObservedEV*100).toFixed(1)+"%"}</strong><p className={small}>{pt?"Não equivale à probabilidade de queda na cotação.":"Not an empirically estimated downside probability."}</p></div>
        </div>}
        {!!risk?.histogram.length && <div className="mt-3 flex h-28 items-end gap-1" aria-label="Monte Carlo enterprise-value distribution histogram">
          {risk.histogram.map((b,i)=><div key={i} className="flex-1 rounded-t bg-cyan-700/80" title={`${b.minimumEvBn.toFixed(0)}–${b.maximumEvBn.toFixed(0)} B: ${b.count}`} style={{height:`${Math.max(2,100*b.count/Math.max(1,...risk.histogram.map(h=>h.count)))}%`}} />)}
        </div>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {DEFAULT_RISK_RANGES.map(d=><label key={d.key} className="block"><div className="flex justify-between gap-2 text-xs"><span className="text-slate-300">{DEFAULT_DRIVER_SPECS.find(x=>x.key===d.key)?.name??d.key}</span><span className="text-white">±{(riskRanges[d.key]??d.halfWidthPp).toFixed(2)} pp</span></div><input className="w-full accent-cyan-400" type="range" min="0" max={Math.min(30,d.halfWidthPp*3)} step="0.25" value={riskRanges[d.key]??d.halfWidthPp} onChange={e=>setRiskRanges(x=>({...x,[d.key]:Number(e.target.value)}))}/></label>)}
        </div>
        <label className="mt-3 block"><div className="flex justify-between gap-2 text-xs text-slate-300"><span>{pt?"Correlação suposta entre crescimento e margem":"Assumed growth–margin correlation"}</span><span>{growthMarginCorrelation.toFixed(2)}</span></div><input className="w-full accent-cyan-400" type="range" min="-0.8" max="0.8" step="0.1" value={growthMarginCorrelation} onChange={e=>setGrowthMarginCorrelation(Number(e.target.value))}/></label>
        {!!risk?.driverRiskPriority.length && <div className="mt-4 border-t border-slate-700 pt-2">
          <h5 className="mb-2 text-xs font-semibold text-white">{pt?"Prioridade por impacto × intervalo da hipótese":"Scenario-scaled materiality: valuation sensitivity × specified ranges"}</h5>
          <div className="grid gap-2 sm:grid-cols-2">{risk.driverRiskPriority.slice(0,6).map((d,i)=><div key={d.key} className="flex justify-between gap-3 text-xs text-slate-300"><span>{i+1}. {DEFAULT_DRIVER_SPECS.find(x=>x.key===d.key)?.name??d.key}</span><strong className="text-white">{d.scoreBn===null?"—":money(d.scoreBn,current.currency)}</strong></div>)}</div>
          <p className={`mt-2 ${small}`}>{pt?"O ranking usa perturbações isoladas de amplitudes presumidas; não integra causalidade, pesquisa possível nem riscos de cauda.":"Ranking uses isolated model perturbations across analyst-assumed ranges; not a complete expected-loss, causality or tail-risk model."}</p>
        </div>}
        {!risk && <p className="mt-2 text-xs text-amber-300">{pt?"Intervalos incompatíveis com o modelo; ajuste WACC/crescimento perpétuo e distribuições.":"No valid scenario ensemble. Adjust the WACC/perpetual-growth assumptions and ranges."}</p>}
      </article>
      <article className="rounded-xl border border-slate-700 bg-slate-800/30 p-4">
        <h4 className="text-base font-semibold text-white">{pt ? "Ranking de materialidade" : "Value-driver materiality ranking"}</h4>
        <p className={`mt-1 ${small}`}>{pt ? "Sensibilidade determinística de um fator por vez. Choques têm magnitudes e probabilidades diferentes; classificação de incerteza é manual." : "Deterministic one-at-a-time enterprise-value sensitivities. Shocks vary in scale and likelihood: the ranking is NOT a probability-weighted risk score. Rate uncertainty manually."}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs">
          <thead className="border-b border-slate-600 text-slate-400"><tr><th className="py-2 pr-3">#</th><th className="pr-3">{pt ? "Direcionador" : "Driver"}</th><th className="pr-3">{pt ? "Choque" : "Shock"}</th><th className="pr-3">{pt ? "EV: choque −" : "EV: −shock"}</th><th className="pr-3">{pt ? "EV: choque +" : "EV: +shock"}</th><th className="pr-3">{pt ? "Incerteza" : "Uncertainty"}</th></tr></thead>
          <tbody>{ranking.map((r, i) => <tr key={r.key} className="border-b border-slate-700/60 text-slate-200"><td className="py-2 pr-3">{i+1}</td><td className="pr-3 font-semibold" title={r.rationale}>{r.name}</td><td className="pr-3">±{r.shock}pp</td><td className="pr-3">{r.minusImpactPct === null ? "—" : pct(r.minusImpactPct)}</td><td className="pr-3">{r.plusImpactPct === null ? "—" : pct(r.plusImpactPct)}</td><td className="pr-3"><label><span className="sr-only">{r.name} uncertainty</span><select className="rounded border border-slate-600 bg-slate-900 p-1 text-slate-200" value={uncertainty[r.key] ?? "unrated"} onChange={e=>setUncertainty(x=>({...x,[r.key]:e.target.value as Uncertainty}))}>{uncertaintyKeys.map(u=><option key={u} value={u}>{u}</option>)}</select></label></td></tr>)}</tbody>
        </table></div>
        <div className="mt-3 space-y-2">
          {ranking.slice(0,3).map(r=><div key={r.key} className="flex items-center gap-2 text-xs"><span className="w-32 truncate text-slate-300" title={r.name}>{r.name}</span><div className="h-2 flex-1 overflow-hidden rounded bg-slate-700"><div className="h-full rounded bg-cyan-500" style={{ width: `${100 * r.maxAbsImpactPct / Math.max(0.001,ranking[0]?.maxAbsImpactPct || 1)}%` }}/></div><span className="w-16 text-right text-slate-300">{r.maxAbsImpactPct.toFixed(1)}%</span></div>)}
        </div>
        <p className={`mt-3 ${small}`}>{pt ? "Priorize alta sensibilidade + alta incerteza quando houver evidência adicional pesquisável; riscos regulatórios ou de cauda seguem em monitoramento separado." : "Research priority is strongest when sensitivity AND genuine uncertainty are high and incremental research can resolve it. Tail risks remain separate; this tool does not silently score researchability."}</p>
      </article>
      <div className={CALL_OUT}>
        <button type="button" className="text-sm font-semibold text-cyan-300 underline" aria-expanded={showProjection} onClick={()=>setShowProjection(x=>!x)}>{showProjection ? (pt ? "Ocultar projeções" : "Hide projection detail") : (pt ? "Ver projeção anual auditável" : "Show auditable forecast schedule")}</button>
        {showProjection && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[570px] text-right text-xs text-slate-300"><thead><tr><th>Year</th><th>Growth</th><th>Revenue ({current.currency} B)</th><th>NOPAT</th><th>Reinvested</th><th>FCFF</th><th>PV FCFF</th></tr></thead><tbody>{valuation.result.years.map(y=><tr key={y.year} className="border-t border-slate-700"><td>{y.year}</td><td>{y.growthPct.toFixed(1)}%</td><td>{y.revenueBn.toFixed(1)}</td><td>{y.nopatBn.toFixed(1)}</td><td>{y.reinvestmentBn.toFixed(1)}</td><td>{y.fcffBn.toFixed(1)}</td><td>{y.presentValueBn.toFixed(1)}</td></tr>)}</tbody></table></div>}
      </div>
    </>}
  </section>;
}
