import { mysqlTable, bigint, varchar, text, int, double, timestamp, uniqueIndex, index } from "drizzle-orm/mysql-core";

/** Phase 1 company/filing/observation store. Source PDFs are not persisted. */
export const companies = mysqlTable("companies", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  jurisdiction: varchar("jurisdiction", {length: 2}).notNull(),
  registryId: varchar("registry_id", {length: 64}).notNull(),
  legalName: varchar("legal_name", {length: 255}).notNull(),
  ticker: varchar("ticker", {length: 32}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [uniqueIndex("uq_company_identity").on(t.jurisdiction,t.registryId)]);

export const filings = mysqlTable("filings", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  companyId: bigint("company_id", {mode:"number",unsigned:true}).notNull().references(()=>companies.id),
  filingKey: varchar("filing_key",{length:191}).notNull(),
  formType: varchar("form_type",{length:64}).notNull(),
  periodEnd: varchar("period_end",{length:10}).notNull(),
  filedAt: varchar("filed_at",{length:10}).notNull(),
  sourceUrl: text("source_url"),
  createdAt:timestamp("created_at").notNull().defaultNow(),
},t=>[uniqueIndex("uq_company_filing").on(t.companyId,t.filingKey),index("ix_filing_period").on(t.companyId,t.periodEnd)]);

export const financialObservations = mysqlTable("financial_observations", {
  id: bigint("id",{mode:"number",unsigned:true}).autoincrement().primaryKey(),
  filingId:bigint("filing_id",{mode:"number",unsigned:true}).notNull().references(()=>filings.id),
  metric:varchar("metric",{length:100}).notNull(),
  periodEnd:varchar("period_end",{length:10}).notNull(),
  periodKind:varchar("period_kind",{length:3}).notNull(),
  fiscalYear:int("fiscal_year").notNull(),
  fiscalQuarter:int("fiscal_quarter"),
  // Decimal source values are preserved as strings to avoid binary float storage rounding.
  value:varchar("value",{length:128}),
  currency:varchar("currency",{length:8}),
  unit:varchar("unit",{length:64}).notNull(),
  sourceSection:text("source_section").notNull(),
  sourceUrl:text("source_url"),
  createdAt:timestamp("created_at").notNull().defaultNow(),
},t=>[index("ix_observation_filing").on(t.filingId),index("ix_observation_period").on(t.metric,t.periodKind,t.fiscalYear)]);
