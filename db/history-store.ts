import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { companies, filings, financialObservations } from "./schema";
import { reconcileFinancialHistory, type FinancialObservation } from "../contracts/financial-history";

/** Opt-in persistence. Never instantiate DB connections at import time. */
export function createHistoryStore(databaseUrl: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for historical storage");
  const pool = mysql.createPool({uri:databaseUrl,connectionLimit:5});
  const db = drizzle(pool);
  return {
    async close() { await pool.end(); },
    async saveCompany(input:{jurisdiction:"us"|"br";registryId:string;legalName:string;ticker?:string|null}) {
      if(!input.registryId.trim() || !input.legalName.trim()) throw new Error("Verified registry ID and legal name required");
      await db.insert(companies).values({jurisdiction:input.jurisdiction,registryId:input.registryId,legalName:input.legalName,ticker:input.ticker ?? null})
        .onDuplicateKeyUpdate({set:{legalName:input.legalName,ticker:input.ticker ?? null}});
      const rows=await db.select().from(companies).where(and(eq(companies.jurisdiction,input.jurisdiction),eq(companies.registryId,input.registryId))).limit(1);
      if(!rows[0]) throw new Error("Company insert failed");
      return rows[0];
    },
    async saveFiling(input:{companyId:number;filingKey:string;formType:string;periodEnd:string;filedAt:string;sourceUrl?:string|null}) {
      if(!input.filingKey.trim()) throw new Error("Source filing ID required");
      if(!isDate(input.periodEnd)||!isDate(input.filedAt)) throw new Error("Valid ISO filing dates required");
      await db.insert(filings).values({...input,sourceUrl:input.sourceUrl ?? null})
        .onDuplicateKeyUpdate({set:{formType:input.formType,periodEnd:input.periodEnd,filedAt:input.filedAt,sourceUrl:input.sourceUrl ?? null}});
      const rows=await db.select().from(filings).where(and(eq(filings.companyId,input.companyId),eq(filings.filingKey,input.filingKey))).limit(1);
      if(!rows[0]) throw new Error("Filing insert failed");
      return rows[0];
    },
    /** Replace facts for a filing atomically, preventing stale/partial fact sets. */
    async replaceObservations(filingId:number, observations:FinancialObservation[]) {
      if(!Number.isSafeInteger(filingId)||filingId<=0) throw new Error("Invalid filing ID");
      const check=reconcileFinancialHistory(observations);
      if(check.flags.some(f=>f.code==="INVALID_OBSERVATION" || f.code==="MISSING_EVIDENCE")) throw new Error("Observations failed validation");
      if(observations.some(o=>!o.currency || !o.sourceSection.trim() || o.value !== null && !Number.isFinite(o.value))) throw new Error("Unverified observation");
      const target=await db.select().from(filings).where(eq(filings.id,filingId)).limit(1);
      if(!target[0]) throw new Error("Filing not found");
      if(observations.some(o=>o.filingId!==target[0].filingKey || o.filedAt!==target[0].filedAt)) throw new Error("Filing identity mismatch");
      await db.transaction(async tx=>{
        await tx.delete(financialObservations).where(eq(financialObservations.filingId,filingId));
        if(observations.length) await tx.insert(financialObservations).values(observations.map(o=>({
          filingId,metric:o.metric,periodEnd:o.periodEnd,periodKind:o.periodKind,fiscalYear:o.fiscalYear,fiscalQuarter:o.fiscalQuarter ?? null,
          value:o.value===null?null:String(o.value),currency:o.currency,unit:o.unit,sourceSection:o.sourceSection,sourceUrl:o.sourceUrl ?? null,
        })));
      });
    },
    async getHistory(companyId:number) {
      const fs=await db.select().from(filings).where(eq(filings.companyId,companyId));
      const observations:FinancialObservation[]=[];
      for(const filing of fs) {
        const facts=await db.select().from(financialObservations).where(eq(financialObservations.filingId,filing.id));
        for(const fact of facts) observations.push({
          metric:fact.metric,periodEnd:fact.periodEnd,periodKind:fact.periodKind as FinancialObservation["periodKind"],
          fiscalYear:fact.fiscalYear,fiscalQuarter:fact.fiscalQuarter as FinancialObservation["fiscalQuarter"] ?? undefined,
          value:fact.value===null?null:Number(fact.value),currency:fact.currency,unit:fact.unit,
          filingId:filing.filingKey,filedAt:filing.filedAt,sourceSection:fact.sourceSection,sourceUrl:fact.sourceUrl ?? undefined,
        });
      }
      return reconcileFinancialHistory(observations);
    },
  };
}
function isDate(s:string) {return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;}
