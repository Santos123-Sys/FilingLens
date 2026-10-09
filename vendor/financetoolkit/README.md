# FinanceToolkit scalar integration

Source: https://github.com/JerBouma/FinanceToolkit/tree/a232ddf84d4bb2da17e5385b7862873b6943c2a8

Upstream MIT license is preserved in LICENSE.txt. `valuation.ts` adapts the discount timing, perpetuity terminal value and enterprise-value formulas from `financetoolkit/models/intrinsic_model.py` and `financetoolkit/ratios/valuation_model.py` to scalar TypeScript. FilingLens supplies five reviewed FCFF projections. This is a small vendored integration, not the complete FinanceToolkit package or its data providers. No Python service, pandas runtime, external MCP connection or private filing transfer is required.

DCF numerical tests use independently calculated hand cases and constant-flow parity with upstream. Comps includes minority/preferred adjustments explicitly; missing adjustments are not silently assumed zero for automatic proposals.
