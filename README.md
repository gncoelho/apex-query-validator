# Apex Query Validator

This Visual Studio Code extension helps enforce the DAO (Data Access Object) pattern in Salesforce projects by identifying SOQL and SOSL queries that are not located in designated DAO or Test files. It highlights queries in the editor, reports them in the Problems panel, and suggests the right DAO file to move them to — all without leaving VS Code.

In addition to DAO-placement checks, the extension runs a suite of **query quality rules** that flag correctness bugs, performance anti-patterns, security risks, style issues, governor-limit concerns, and unknown object/field names across every Apex file in the workspace.

## Features

* **Query Detection**: Scans Apex files (`.cls`/`.trigger` by default) for embedded SOQL and SOSL queries — including dynamic `Database.query('…')` / `Search.query('…')` strings.
* **Editor Highlighting**: Highlights flagged queries with a yellow background in the active editor.
* **Problems Panel**: Reports each finding as a diagnostic (carrying its rule id as the diagnostic `code`) so findings appear in the Problems panel and in inline squiggles.
* **Automatic Validation**: Runs automatically when an Apex file is opened or saved (configurable).
* **Validate Whole Project**: A single command scans every matching file in the workspace and reports all findings at once, with a summary showing total files scanned and query counts.
* **Quick Fixes**: One-click fixes for many rules (add `LIMIT`, replace deprecated `SIDEBAR`, wrap variables in `String.escapeSingleQuotes()`, generate a DAO method, and more — see [Quick Fixes](#quick-fixes)).
* **Inline Suppression**: Silence an intentional finding with a comment (see [Inline suppression](#inline-suppression)).
* **Per-rule configuration**: Toggle or re-severity any individual rule (see [Per-rule configuration](#per-rule-configuration)).
* **Query Quality Rules**: Configurable rules across six categories flag common query problems even inside DAO files (see below).

### Query Quality Rules

All rule categories are enabled by default and can be toggled individually via settings.

#### Correctness rules (`apexQueryValidator.enableCorrectnessRules`)

These catch guaranteed runtime or compile failures.

| Rule ID | Trigger |
|---|---|
| `correctness/single-row-no-limit` | A query assigned to a single SObject (`Account a = [...]`) or indexed with `[...][0]` without `LIMIT 1`. Throws `QueryException` on 0 or >1 rows. |
| `correctness/offset-too-large` | SOQL `OFFSET` greater than 2000 (a hard limit). |
| `correctness/sosl-min-length` | SOSL search term shorter than the 2-character minimum. |
| `correctness/fields-macro-needs-limit` | `FIELDS(ALL)` or `FIELDS(CUSTOM)` used without a `LIMIT` of 200 or fewer. |

#### Performance rules (`apexQueryValidator.enablePerformanceRules`)

| Rule ID | Trigger |
|---|---|
| `perf/missing-limit` | SOQL query with no `LIMIT` clause (and no aggregate function). May return up to 50,000 rows. |
| `perf/wide-field-list` | SOQL SELECT clause exceeds `apexQueryValidator.maxSelectFields` fields (default: 10). |
| `perf/soql-in-loop` | SOQL query detected inside a `for`, `while`, or `do`-`while` loop body. Can exhaust the 100-query transaction limit. |
| `perf/unbounded-large-object` | SOQL on a known large SObject (configurable via `apexQueryValidator.largeObjects`) with no `WHERE` clause. |
| `perf/order-by-no-limit` | SOQL with `ORDER BY` but no `LIMIT`. Forces sorting of an unbounded result set. |
| `perf/non-selective-filter` | WHERE clause uses a non-selective filter (leading-wildcard `LIKE '%…'`, `!=`, `<>`, `NOT IN`, `NOT LIKE`). Information severity. |
| `perf/count-via-size` | A query result used only for `.size()` — use `SELECT COUNT()` instead. Information severity. |
| `perf/too-many-subqueries` | More child `(SELECT …)` subqueries than `apexQueryValidator.maxSubqueries` (default: 5). Information severity. |

#### Security rules (`apexQueryValidator.enableSecurityRules`)

| Rule ID | Trigger |
|---|---|
| `security/dynamic-soql-concat` | A dynamic SOQL call (`Database.query`, `getQueryLocator`, `countQuery`) whose argument concatenates an unescaped, non-literal value. Skips `*WithBinds` calls and values already wrapped in `String.escapeSingleQuotes()`. |
| `security/dynamic-sosl-concat` | A dynamic SOSL call (`Search.query`, `Database.search`) with the same unescaped concatenation risk. |
| `security/hardcoded-id` | A 15- or 18-character Salesforce record ID literal found in a `WHERE` clause. Breaks across orgs. |
| `security/user-input-in-where` | SOQL `WHERE` clause contains a string literal with no bind variable. Informational — consider using `:variable` syntax. |
| `security/missing-security-enforced` | **Opt-in** (`apexQueryValidator.enforceSecurityClause`): SOQL with no `WITH SECURITY_ENFORCED` / `WITH USER_MODE` / `WITH SYSTEM_MODE` clause. |

#### Style rules (`apexQueryValidator.enableStyleRules`)

Style findings are always reported at **Information** severity.

| Rule ID | Trigger |
|---|---|
| `style/select-id-only` | SOQL SELECT clause contains only `Id`. Consider whether additional fields are needed. |
| `style/aggregate-missing-group-by` | SOQL uses an aggregate function (`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`) without `GROUP BY`. |
| `style/sosl-no-returning` | SOSL query has no `RETURNING` clause. Returns all accessible objects and fields, which is rarely intentional. |
| `style/sosl-sidebar-scope` | SOSL query uses the deprecated `IN SIDEBAR FIELDS` scope. |

#### Governor-limit rules (`apexQueryValidator.enableGovernorRules`)

| Rule ID | Trigger |
|---|---|
| `governor/too-many-queries` | File contains more inline SOQL/SOSL queries than `apexQueryValidator.maxQueriesPerFile` (default: 5). One diagnostic at the top of the file. |
| `governor/dynamic-soql-call` | A dynamic SOQL call (`Database.query` / `getQueryLocator` / `countQuery` and their `*WithBinds` variants). Bypasses bracket-query detection and still counts against the 100-query governor limit. |
| `governor/dynamic-sosl-call` | A dynamic SOSL call (`Search.query()` or `Database.search()`). |

#### Metadata rules (`apexQueryValidator.enableMetadataRules`)

These validate names against your project's local SFDX metadata (`objects/**/*.object-meta.xml` and `.../fields/*.field-meta.xml`) — fully offline, no org connection. To stay high-precision they only flag **custom (`__c`) names they can positively disprove**; standard and managed-package (namespaced) names are never flagged.

| Rule ID | Trigger |
|---|---|
| `metadata/unknown-object` | A custom (`__c`) SObject in a `FROM` clause that is not present in local metadata (likely a typo or a missing object). |
| `metadata/unknown-field` | A custom (`__c`) field in a `SELECT` clause that is not present on the queried object in local metadata. Skips relationship paths, functions, aliases, and queries with subqueries. |

## How to Use

### Single-file validation

1. Open an Apex `.cls` or `.trigger` file.
2. Validation runs automatically on open and save.
3. To run it manually, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for **Apex Query Validator: Validate SOQL/SOSL**.
4. Flagged queries are highlighted in the editor and listed in the Problems panel.
5. If the file is a DAO or test file, the DAO-placement check is skipped — but quality rules (correctness, performance, security, style, governor, metadata) still run.

### Whole-project validation

1. Open the Command Palette and search for **Apex Query Validator: Validate Whole Project (SOQL/SOSL)**.
2. A progress notification appears while the workspace is scanned.
3. All findings are reported in the Problems panel across every matching file.
4. A summary notification shows how many files were scanned and the total query counts.

### DAO Quick Fix

After a query is flagged (by either command or auto-validation):

1. Place the cursor on a highlighted query or click the lightbulb icon (or press `Ctrl+.` / `Cmd+.`).
2. If a DAO file exists whose name contains the queried SObject name, two Quick Fixes appear — for a `[SELECT Id FROM Account]` query with `AccountDAO.cls` present:
   * **"Open AccountDAO.cls"** — opens the DAO file so you can move the query there manually.
   * **"Move query to getAccounts() in AccountDAO.cls"** — generates a `public static` method wrapping the query in the DAO and replaces the inline query with a call to it.

**Example:**

```apex
public class MyApexClass {
    public void myMethod() {
        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Name LIKE '%Test%'];
        List<Contact> contacts = [SELECT Id, Email FROM Contact];
        List<List<SObject>> searchList = [FIND 'John' IN NAME FIELDS RETURNING Contact(Id, Name)];
    }
}
```

The extension will:

* Detect two SOQL queries (`Account`, `Contact`) and one SOSL query (`Contact`).
* Highlight them and list them in the Problems panel.
* Show Quick Fix suggestions: **"Open AccountDAO.cls"** and **"Open ContactDAO.cls"** if those files exist in the project.
* Show a message: `"2 SOQL queries found that should be moved to a DAO class. 1 SOSL query found that should be moved to a DAO class."`

### Quick Fixes

Beyond the DAO fixes above, the lightbulb offers rule-specific Quick Fixes:

| Rule | Quick Fix |
|---|---|
| `perf/missing-limit`, `perf/order-by-no-limit` | Add `LIMIT <apexQueryValidator.quickFixLimit>` (default 200) |
| `correctness/single-row-no-limit` | Add / normalize `LIMIT 1` |
| `security/missing-security-enforced` | Add `WITH SECURITY_ENFORCED` |
| `security/dynamic-soql-concat`, `security/dynamic-sosl-concat` | Wrap concatenated variables in `String.escapeSingleQuotes()` |
| `security/hardcoded-id` | Extract the Id into a `private static final Id` class constant |
| `style/sosl-sidebar-scope` | Replace `SIDEBAR` with `ALL FIELDS` |
| `dao/soql-placement`, `dao/sosl-placement` | Generate a DAO method and replace the inline query with a call |

### Inline suppression

Silence an intentional finding with a comment. Directives accept rule ids or category names (space/comma separated); a bare directive suppresses everything on its scope, and text after ` -- ` is treated as a reason.

```apex
// aqv-disable-next-line perf/missing-limit -- one-off admin query
List<Account> all = [SELECT Id FROM Account];

Account a = [SELECT Id FROM Account]; // aqv-disable-line correctness/single-row-no-limit

// aqv-disable security   (file-level: suppress the whole security category)
```

### Per-rule configuration

Beyond the per-category toggles, `apexQueryValidator.rules` overrides individual rules by id. Each value is `"off"`, `"information"`, `"warning"`, or `"error"`, and takes precedence over the category toggle and the global `diagnosticSeverity` (a severity value also force-enables a rule whose category is disabled):

```json
"apexQueryValidator.rules": {
  "style/select-id-only": "off",
  "perf/missing-limit": "error"
}
```

## Commands

Both commands are grouped under the **Apex Query Validator** category in the Command Palette. Tip: type **`aqv`** (matching the **A**pex **Q**uery **V**alidator initials) — or "Apex Query" — to surface them quickly.

| Command | Description |
|---|---|
| **Apex Query Validator: Validate SOQL/SOSL** | Validates the currently active editor file. |
| **Apex Query Validator: Validate Whole Project (SOQL/SOSL)** | Scans all matching files in the workspace and reports findings in the Problems panel with an aggregate summary. |

## Settings

### General

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.exemptFilenameKeywords` | `["dao", "test"]` | Filename substrings that exempt a file from DAO-placement validation entirely (e.g. DAO and test files). Quality rules still run. |
| `apexQueryValidator.daoFilenameKeywords` | `["dao"]` | Filename substrings that identify DAO files. Used by the Quick Fix to suggest which DAO a query should be moved to. |
| `apexQueryValidator.includeGlobs` | `["**/*.cls", "**/*.trigger"]` | Glob patterns identifying which files should be validated. |
| `apexQueryValidator.diagnosticSeverity` | `"Warning"` | Severity level (`"Warning"` or `"Error"`) used for findings in the Problems panel. Style findings are always `Information` regardless of this setting. |
| `apexQueryValidator.autoValidate` | `true` | When `true`, validation runs automatically whenever an Apex file is opened or saved. |

### Rule categories

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.enableCorrectnessRules` | `true` | Enable correctness rules that catch guaranteed runtime/compile failures. |
| `apexQueryValidator.enablePerformanceRules` | `true` | Enable performance rules (missing LIMIT, wide field list, SOQL in loop, unbounded large-object query, ORDER BY without LIMIT, non-selective filters, `.size()` counting, subquery count). |
| `apexQueryValidator.enableSecurityRules` | `true` | Enable security rules (dynamic SOQL/SOSL concatenation, hardcoded IDs, unbound literal in WHERE). |
| `apexQueryValidator.enableStyleRules` | `true` | Enable style rules (SELECT Id only, aggregate without GROUP BY, SOSL without RETURNING, deprecated SIDEBAR scope). Always reported at Information severity. |
| `apexQueryValidator.enableGovernorRules` | `true` | Enable governor-limit rules (too many queries in one file, dynamic SOQL/SOSL calls). |
| `apexQueryValidator.enableMetadataRules` | `true` | Enable offline metadata rules that validate SObject/field names against local SFDX metadata. |

### Per-rule overrides

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.rules` | `{}` | Per-rule overrides keyed by rule id, each `"off"` / `"information"` / `"warning"` / `"error"`. Takes precedence over the category toggle and `diagnosticSeverity`. |
| `apexQueryValidator.enforceSecurityClause` | `false` | Opt-in: enable `security/missing-security-enforced`. |

### Rule thresholds & fixes

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.maxSelectFields` | `10` | Maximum number of fields in a SOQL SELECT clause before `perf/wide-field-list` fires. |
| `apexQueryValidator.maxSubqueries` | `5` | Maximum number of child subqueries before `perf/too-many-subqueries` fires. |
| `apexQueryValidator.largeObjects` | `["ContentDocument", "ContentVersion", "Task", "Event", "EmailMessage", "FeedItem"]` | SObjects considered large. A query on any of these without a WHERE clause triggers `perf/unbounded-large-object`. |
| `apexQueryValidator.maxQueriesPerFile` | `5` | Maximum number of inline SOQL/SOSL queries per file before `governor/too-many-queries` fires. |
| `apexQueryValidator.quickFixLimit` | `200` | The `LIMIT` value inserted by the "Add LIMIT" Quick Fix. |

## Known Limitations

- The extension activates when the workspace contains `.cls` or `.trigger` files. If `includeGlobs` is customized to cover other extensions, the extension may need to be triggered manually the first time.
- For SOQL queries containing subqueries (e.g. `SELECT Id, (SELECT Id FROM Contacts) FROM Account`), the DAO Quick Fix uses the first `FROM` clause found, which may point to the inner object rather than the outer one.
- The DAO Quick Fix navigates to the DAO file but does not move the query automatically — the refactoring step is left to the developer.
- **`perf/soql-in-loop`**: Loop detection is regex-based and works by matching brace structure in the raw text. It may produce false positives in highly nested or multi-line loop bodies with unusual formatting, and does not parse Apex semantics.
- **`security/user-input-in-where`**: This rule is a heuristic. It flags any `WHERE` clause that contains a string literal and no bind variable (`:variable`). It will not fire if a bind variable is present anywhere in the clause, even if other literals are also present.
- **`security/hardcoded-id`**: Detects a quoted 15- or 18-character alphanumeric string in a `WHERE` clause whose 3-character key prefix contains a digit. Rare non-ID strings with a digit-bearing prefix could still be false positives.
- **`governor/too-many-queries`**: Only counts inline `[SELECT…]` and `[FIND…]` bracket queries. `Database.query()` and `Search.query()` calls are counted separately by `governor/dynamic-soql-call` and `governor/dynamic-sosl-call` and do not contribute to the `maxQueriesPerFile` threshold.
- **Metadata rules** (`metadata/unknown-object`, `metadata/unknown-field`): Validate against **local SFDX source only** — standard objects/fields (not present in source) and namespaced managed-package names are never flagged, and only custom `__c` names that can be positively disproven are reported. Field validation is skipped for queries containing subqueries.
- **`perf/non-selective-filter`**: A heuristic reported at Information severity. Some non-selective filters are unavoidable; suppress per-line or turn the rule `"off"` where appropriate.
- **Dynamic queries**: Inline rules apply to `Database.query('…')` only when the argument is a single static string literal. Queries built by concatenation are checked for injection but not for placement/LIMIT/etc.

## Requirements

- Visual Studio Code 1.93.0 or higher.
- Works best with Salesforce Apex development environments.
