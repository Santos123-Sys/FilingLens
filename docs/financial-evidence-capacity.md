# Financial evidence warning capacity

The platform audit reproduced an input with one hundred model-supplied flags and an invalid financial quote. The binder removed the quote, but slicing the first hundred flags discarded the appended server rejection/incompleteness diagnostics. Merging additional deterministic diagnostics could also exceed the schema's hundred-record maximum.

Server evidence flags now occupy capacity first. The model cannot supply reserved `FINANCIAL_EVIDENCE_` codes; the binder computes these from actual source checks. The financial validation stage prioritizes evidence and runtime diagnostics, deduplicates code/period pairs and bounds the final array to one hundred records. Lower-priority model notes can be omitted when that limit is reached. Amounts, financial formulas, prompts, model routing and source quotes are unchanged.

The saturated-input regression requires both server evidence flags to survive, deterministic tools to preserve them, and the final output to parse under the shared financial contract. The ordinary source-binding tests remain required. No migration or infrastructure change is needed. Rollback is a code revert; it restores the demonstrated warning-suppression risk. Wider answer quality is not established by this deterministic regression.
