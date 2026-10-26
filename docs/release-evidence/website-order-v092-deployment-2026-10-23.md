# Website paid-order follow-up v0.9.2 — production deployment

- Release snapshot: `0e5ed79aaed166df3162cef1495646f455e5117079b4514d59740050168ab7ea` (1153 exact source files).
- Previous installed snapshot: `e038de83e94015c5f5ad17a9fea7c60dd888a4f983a5df72341517702ffc0696` (v0.9.1).
- Fresh FULL backup: `20261022T223020Z-pre-v092-71933b54`; checksum, upload archive and PostgreSQL catalog checks passed. An isolated networkless PG16 restore passed with 72 tables, 44 migrations and the named website API key. Production database was not restored.
- Candidate API image: `sha256:1bc5032d80eb99b1be5e7f3601934e2cfea46fccf5931c4f5ffe664e0f95c611`.
- Candidate web image: `sha256:9f94792dc8bbd3bebc1dca8da91054766e47dc476092af8e9400b3b5ea1acdd4`.
- The server's cached Node base changed from 22.23.3 to 22.23.4 between releases. Both images built successfully; a release gate allowed exactly that one environment value after all other keys matched. The original stage/build evidence and release helpers were preserved in the private release directory, and the pair was reattested before the switch.
- Guarded API/web switch passed. No migration, seed, tax recalculation, payment mutation, source-order replay or historical customer reassignment occurred. PostgreSQL and Redis containers were retained.
- Installed checks passed: source hashes, image pins, healthy pair, PostgreSQL/Redis identity, 44 migrations, one website API key, HTTPS 200 for `/`, `/api/health`, and `/parent-measurements`; direct ports 3500/4500 remained unavailable. Post-switch aggregate logs showed zero API/web error lines in the checked interval.
- Local checks before deployment: `pnpm quality:check` passed; isolated PostgreSQL 13/13 passed; Playwright at 1920/1366/390 passed with local synthetic fixtures. An authenticated production browser check was not performed; no reusable owner session was present.
- Known data limitation: existing website order #22727 remains attached to its historical client and has no `externalNumber`. The new contact-matching rule applies to future imports. A separate, audited correction would be required for this existing record.

Private deployment receipts and logs are under `.local/v092-deploy/` in the deployment worktree. No commit or push was performed.
