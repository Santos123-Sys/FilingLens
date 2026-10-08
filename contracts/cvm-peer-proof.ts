import type {MarketResult} from "./analysis";
import type {RegulatoryDataSnapshot,RegulatoryDataMetric} from "./regulatory-data";
type Peer=NonNullable<MarketResult["market"]["competitiveAnalysis"]>["peerProfiles"][number];
type Official=NonNullable<Peer["officialHistory"]>[number];
const name=(raw:string)=>raw.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toUpperCase().replace(/\b(?:S\.?\s*A\.?|LTDA|SOCIEDADE ANONIMA|S\/A)\b/g,"")
 .replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");
const digits=(s:string)=>s.replace(/\D/g,"");
const date=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&
 !Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const unitToMillions=(raw:string|null|undefined)=>{
 const u=(raw??"").trim().toUpperCase();
 if(["BRL MILLIONS","BRL MILHÕES","BRL MILHOES"].includes(u))return 1;
 if(["BRL THOUSANDS","BRL MILHARES"].includes(u))return 0.001;
 if(["BRL UNITS","BRL REAIS"].includes(u))return 0.000001;
 return null; // Never infer the DFP escala_moeda from nationality alone.
};
const officialCvm=(source:RegulatoryDataMetric["source"])=>{
 try{const u=new URL(source?.url??"");return u.protocol==="https:"&&u.hostname==="dados.cvm.gov.br"
  &&(/\/DFP\//i.test(u.pathname)||/dfp_cia_aberta_/i.test(u.pathname));}catch{return false;}
};
export function verifiedCvmDfpPeerFacts(peerName:string,cnpj:string,snapshot:RegulatoryDataSnapshot|null):Official[]{
 if(!snapshot||snapshot.provider!=="cvm_open_data"||snapshot.jurisdiction!=="br"||
   !["complete","partial"].includes(snapshot.status)||!/^\d{14}$/.test(digits(cnpj))||
   digits(snapshot.resolvedIdentifier??"")!==digits(cnpj))return [];
 const identity=snapshot.company;
 const found=["legalName","companyName","name","DENOM_CIA","denom_cia"].flatMap(k=>
  typeof identity[k]==="string"?[String(identity[k])]:[]);
 if(!found.length||!found.some(n=>name(n)===name(peerName)))return [];
 const metricMap:Record<string,Official["metric"]>={
  revenue:"revenue",netIncome:"netIncome",ebit:"operatingIncome",grossProfit:"grossProfit",
 };
 const candidates:Official[]=[];
 for(const m of snapshot.metrics){
  const key=metricMap[m.key];
  if(!key||m.statementType!=="annual"||m.status!=="verified"||
    !Number.isInteger(m.fiscalYear)||typeof m.period!=="string"||
    !date(m.period)||Number(m.period.slice(0,4))!==m.fiscalYear||
    typeof m.value!=="number"||!Number.isFinite(m.value)||!officialCvm(m.source))continue;
  const scale=unitToMillions(m.unit);
  if(scale===null)continue;
  const value=m.value*scale;
  if(!Number.isFinite(value))continue;
  const year=m.fiscalYear!;
  candidates.push({
   metric:key,year,periodEnd:m.period,amountMillions:value,currency:"BRL",accountingBasis:"br_gaap",
   filingAccession:"CVM-DFP-"+year+"-"+digits(cnpj),
   source:{section:"CVM DFP annual consolidated "+key+"; "+m.period,kind:"citation",
    url:m.source!.url,publisher:"CVM",sourceForm:"DFP",item:m.rawCode??m.rawLabel??key}
  });
 }
 const grouped=new Map<string,Official[]>();
 for(const x of candidates){
  const key=x.metric+"|"+x.year+"|"+x.periodEnd;
  grouped.set(key,[...(grouped.get(key)??[]),x]);
 }
 const valid:Official[]=[];
 for(const points of grouped.values()){
  const base=points[0].amountMillions;
  if(points.some(p=>Math.abs(p.amountMillions-base)>Math.max(0.001,Math.abs(base)*0.000001)))continue;
  valid.push(points[0]);
 }
 const years=[...new Set(valid.map(x=>x.year))].sort((a,b)=>b-a).slice(0,5);
 return valid.filter(x=>years.includes(x.year)).sort((a,b)=>b.year-a.year||a.metric.localeCompare(b.metric)).slice(0,20);
}
