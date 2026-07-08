# Change Log

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