# Change Log

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