# Change Log

### v0.3.0

- Added two new rule categories:
  - **Correctness** (`apexQueryValidator.enableCorrectnessRules`): `correctness/single-row-no-limit`, `correctness/offset-too-large`, `correctness/sosl-min-length`, `correctness/fields-macro-needs-limit`.
  - **Metadata** (`apexQueryValidator.enableMetadataRules`): `metadata/unknown-object`, `metadata/unknown-field` — validate SObject/field names against local SFDX metadata, fully offline. Only flags custom (`__c`) names that can be positively disproven.
- Added performance rules `perf/non-selective-filter`, `perf/count-via-size`, `perf/too-many-subqueries` (all Information severity; new threshold `apexQueryValidator.maxSubqueries`).
- Added security rule `security/dynamic-sosl-concat` and opt-in `security/missing-security-enforced` (`apexQueryValidator.enforceSecurityClause`).
- Broadened dynamic-query detection to `Database.getQueryLocator`, `countQuery`, and their `*WithBinds` variants; the concat rules now ignore `*WithBinds` calls and values already wrapped in `String.escapeSingleQuotes()`.
- Placement, LIMIT, and hardcoded-id rules now also apply to static-string dynamic queries (`Database.query('SELECT …')`).
- Added **inline suppression** comments (`// aqv-disable[-line|-next-line] <rule|category>`).
- Added **per-rule overrides** via `apexQueryValidator.rules` (`off`/`information`/`warning`/`error`); each finding now carries its rule id as the diagnostic `code`.
- Added **Quick Fixes**: add `LIMIT`/`LIMIT 1`, add `WITH SECURITY_ENFORCED`, wrap in `String.escapeSingleQuotes()`, extract a hardcoded Id to a constant, replace deprecated `SIDEBAR`, and generate a DAO method + call (new setting `apexQueryValidator.quickFixLimit`).
- Tightened `security/hardcoded-id` to require a digit in the Id key prefix, and fixed the summary popup to count dynamic queries.
- Grouped both commands under an **Apex Query Validator** Command Palette category (type `aqv` to find them) and set a human-readable extension `displayName`.
- Added the ability to **run a single validation category** (Correctness, Performance, Security, Style, Governor, Metadata, DAO placement): one per-category command each (active file) plus a **Run a Validation…** menu that also runs a category across the whole project. A focused run shows only that category's findings.

### v0.2.0

- Added a rule registry (`runRules`) as the unified engine for all validation. The existing DAO-placement check is now a rule in the registry (`dao/soql-placement`, `dao/sosl-placement`).
- Added four new rule categories, all enabled by default and individually togglable:
  - **Performance** (`apexQueryValidator.enablePerformanceRules`): `perf/missing-limit`, `perf/wide-field-list`, `perf/soql-in-loop`, `perf/unbounded-large-object`, `perf/order-by-no-limit`.
  - **Security** (`apexQueryValidator.enableSecurityRules`): `security/dynamic-soql-concat`, `security/hardcoded-id`, `security/user-input-in-where`.
  - **Style** (`apexQueryValidator.enableStyleRules`): `style/select-id-only`, `style/aggregate-missing-group-by`, `style/sosl-no-returning`, `style/sosl-sidebar-scope`. Always reported at Information severity.
  - **Governor limits** (`apexQueryValidator.enableGovernorRules`): `governor/too-many-queries`, `governor/dynamic-soql-call`, `governor/dynamic-sosl-call`.
- Quality rules (performance, security, style, governor) apply to all files, including DAO and test files. Only the DAO-placement check is skipped for exempt files.
- Added new configurable thresholds: `apexQueryValidator.maxSelectFields` (default: 10), `apexQueryValidator.largeObjects`, `apexQueryValidator.maxQueriesPerFile` (default: 5).

### v0.1.0

- Fixed SOSL regex to match real Apex syntax (bracketed, quoted search term, valid field scopes); legacy unbracketed/curly-brace syntax is no longer matched.
- Fixed a bug where duplicate query strings were highlighted/reported at the wrong position.
- Fixed a decoration-type leak caused by recreating the decoration type on every command run.
- Added VS Code Diagnostics (Problems panel) integration alongside editor highlighting.
- Added automatic validation on file open and save (configurable via `apexQueryValidator.autoValidate`).
- Added configurable settings: `exemptFilenameKeywords`, `includeGlobs`, `diagnosticSeverity`, `autoValidate`.
- Restricted validation by default to `.cls` and `.trigger` files via `includeGlobs`.
- Added GitHub Actions CI running lint and unit tests.
- Reworded validation messages to clarify that detected queries are violations needing a DAO, not confirmations of "valid" queries.

### v0.0.4

- Initial release.
- Supports detection and validation of SOQL and SOSL queries.
- Highlights valid queries in the active editor.