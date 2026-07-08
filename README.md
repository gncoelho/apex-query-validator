# Apex Query Validator

This Visual Studio Code extension helps enforce the DAO (Data Access Object) pattern in Salesforce projects by identifying SOQL and SOSL queries that are not located in designated DAO or Test files. It highlights queries in the editor, reports them in the Problems panel, and suggests the right DAO file to move them to — all without leaving VS Code.

In addition to DAO-placement checks, the extension runs a suite of **query quality rules** that flag performance anti-patterns, security risks, style issues, and governor-limit concerns across every Apex file in the workspace.

## Features

* **Query Detection**: Scans Apex files (`.cls`/`.trigger` by default) for embedded SOQL and SOSL queries.
* **Editor Highlighting**: Highlights flagged queries with a yellow background in the active editor.
* **Problems Panel**: Reports each finding as a diagnostic so they appear in the Problems panel and in inline squiggles.
* **Automatic Validation**: Runs automatically when an Apex file is opened or saved (configurable).
* **Validate Whole Project**: A single command scans every matching file in the workspace and reports all findings at once, with a summary showing total files scanned and query counts.
* **DAO Quick Fix**: A lightbulb (Quick Fix) appears on each flagged query. If a DAO file whose name contains the queried SObject already exists in the project (e.g. `AccountDAO.cls` for `[SELECT Id FROM Account]`), it appears as a suggestion — clicking it opens that file so you can move the query there.
* **Query Quality Rules**: Configurable rules across four categories flag common query problems even inside DAO files (see below).

### Query Quality Rules

All rule categories are enabled by default and can be toggled individually via settings.

#### Performance rules (`apexQueryValidator.enablePerformanceRules`)

| Rule ID | Trigger |
|---|---|
| `perf/missing-limit` | SOQL query with no `LIMIT` clause (and no aggregate function). May return up to 50,000 rows. |
| `perf/wide-field-list` | SOQL SELECT clause exceeds `apexQueryValidator.maxSelectFields` fields (default: 10). |
| `perf/soql-in-loop` | SOQL query detected inside a `for` or `while` loop body. Can exhaust the 100-query transaction limit. |
| `perf/unbounded-large-object` | SOQL on a known large SObject (configurable via `apexQueryValidator.largeObjects`) with no `WHERE` clause. |
| `perf/order-by-no-limit` | SOQL with `ORDER BY` but no `LIMIT`. Forces sorting of an unbounded result set. |

#### Security rules (`apexQueryValidator.enableSecurityRules`)

| Rule ID | Trigger |
|---|---|
| `security/dynamic-soql-concat` | `Database.query()` argument contains string concatenation (`+`). SOQL injection risk. |
| `security/hardcoded-id` | A 15- or 18-character Salesforce record ID literal found in a `WHERE` clause. Breaks across orgs. |
| `security/user-input-in-where` | SOQL `WHERE` clause contains a string literal with no bind variable. Informational — consider using `:variable` syntax. |

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
| `governor/dynamic-soql-call` | Any `Database.query()` call detected. Dynamic SOQL bypasses bracket-query detection and still counts against the 100-query governor limit. |
| `governor/dynamic-sosl-call` | Any `Search.query()` or `Database.search()` call detected. |

## How to Use

### Single-file validation

1. Open an Apex `.cls` or `.trigger` file.
2. Validation runs automatically on open and save.
3. To run it manually, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for **Apex Query Validator: Validate SOQL/SOSL**.
4. Flagged queries are highlighted in the editor and listed in the Problems panel.
5. If the file is a DAO or test file, the DAO-placement check is skipped — but quality rules (performance, security, style, governor) still run.

### Whole-project validation

1. Open the Command Palette and search for **Apex Query Validator: Validate Whole Project (SOQL/SOSL)**.
2. A progress notification appears while the workspace is scanned.
3. All findings are reported in the Problems panel across every matching file.
4. A summary notification shows how many files were scanned and the total query counts.

### DAO Quick Fix

After a query is flagged (by either command or auto-validation):

1. Place the cursor on a highlighted query or click the lightbulb icon (or press `Ctrl+.` / `Cmd+.`).
2. If a DAO file exists whose name contains the queried SObject name, it appears in the Quick Fix list — for example **"Open AccountDAO.cls"** for a `[SELECT Id FROM Account]` query.
3. Selecting it opens the DAO file so you can move the query there manually.

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

## Commands

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
| `apexQueryValidator.enablePerformanceRules` | `true` | Enable performance rules (missing LIMIT, wide field list, SOQL in loop, unbounded large-object query, ORDER BY without LIMIT). |
| `apexQueryValidator.enableSecurityRules` | `true` | Enable security rules (dynamic SOQL string concatenation, hardcoded Salesforce record IDs, unbound string literal in WHERE clause). |
| `apexQueryValidator.enableStyleRules` | `true` | Enable style rules (SELECT Id only, aggregate without GROUP BY, SOSL without RETURNING, deprecated SIDEBAR scope). Always reported at Information severity. |
| `apexQueryValidator.enableGovernorRules` | `true` | Enable governor-limit rules (too many queries in one file, Database.query() calls, Database.search() / Search.query() calls). |

### Rule thresholds

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.maxSelectFields` | `10` | Maximum number of fields in a SOQL SELECT clause before `perf/wide-field-list` fires. |
| `apexQueryValidator.largeObjects` | `["ContentDocument", "ContentVersion", "Task", "Event", "EmailMessage", "FeedItem"]` | SObjects considered large. A query on any of these without a WHERE clause triggers `perf/unbounded-large-object`. |
| `apexQueryValidator.maxQueriesPerFile` | `5` | Maximum number of inline SOQL/SOSL queries per file before `governor/too-many-queries` fires. |

## Known Limitations

- The extension activates when the workspace contains `.cls` or `.trigger` files. If `includeGlobs` is customized to cover other extensions, the extension may need to be triggered manually the first time.
- For SOQL queries containing subqueries (e.g. `SELECT Id, (SELECT Id FROM Contacts) FROM Account`), the DAO Quick Fix uses the first `FROM` clause found, which may point to the inner object rather than the outer one.
- The DAO Quick Fix navigates to the DAO file but does not move the query automatically — the refactoring step is left to the developer.
- **`perf/soql-in-loop`**: Loop detection is regex-based and works by matching brace structure in the raw text. It may produce false positives in highly nested or multi-line loop bodies with unusual formatting, and does not parse Apex semantics.
- **`security/user-input-in-where`**: This rule is a heuristic. It flags any `WHERE` clause that contains a string literal and no bind variable (`:variable`). It will not fire if a bind variable is present anywhere in the clause, even if other literals are also present.
- **`security/hardcoded-id`**: The rule detects any quoted 15- or 18-character alphanumeric string in a `WHERE` clause. Very short field values that happen to be 15 or 18 characters long could be false positives in rare cases.
- **`governor/too-many-queries`**: Only counts inline `[SELECT…]` and `[FIND…]` bracket queries. `Database.query()` and `Search.query()` calls are counted separately by `governor/dynamic-soql-call` and `governor/dynamic-sosl-call` and do not contribute to the `maxQueriesPerFile` threshold.

## Requirements

- Visual Studio Code 1.93.0 or higher.
- Works best with Salesforce Apex development environments.
