# FilingLens source package

This archive contains the complete FilingLens v17 source tree, shared contracts, tests, prompts, documentation, lockfile, build scripts and Sites configuration.

The archive intentionally excludes generated or machine-local material:

- `node_modules/` — restore with `npm ci`
- `dist/` — recreate with `npm run build`
- `.git/` — repository history and remote metadata
- `.env` and credentials — use `.env.example` and configure `OPENAI_API_KEY` securely

Start with `README.md` for setup and `docs/PROJECT_DOCUMENTATION.md` or `docs/FilingLens_Project_Documentation_v17.docx` for the complete system reference.
