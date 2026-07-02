# Apex Query Validator

This Visual Studio Code extension helps enforce the DAO (Data Access Object) pattern in Salesforce projects by identifying SOQL and SOSL queries that are not located in designated DAO or Test files. It highlights queries in the editor, reports them in the Problems panel, and suggests the right DAO file to move them to — all without leaving VS Code.

## Features

* **Query Detection**: Scans Apex files (`.cls`/`.trigger` by default) for embedded SOQL and SOSL queries.
* **Editor Highlighting**: Highlights flagged queries with a yellow background in the active editor.
* **Problems Panel**: Reports each finding as a diagnostic so they appear in the Problems panel and in inline squiggles.
* **Automatic Validation**: Runs automatically when an Apex file is opened or saved (configurable).
* **Validate Whole Project**: A single command scans every matching file in the workspace and reports all findings at once, with a summary showing total files scanned and query counts.
* **DAO Quick Fix**: A lightbulb (Quick Fix) appears on each flagged query. If a DAO file whose name contains the queried SObject already exists in the project (e.g. `AccountDAO.cls` for `[SELECT Id FROM Account]`), it appears as a suggestion — clicking it opens that file so you can move the query there.

## How to Use

### Single-file validation

1. Open an Apex `.cls` or `.trigger` file.
2. Validation runs automatically on open and save.
3. To run it manually, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for **Apex Query Validator: Validate SOQL/SOSL**.
4. Flagged queries are highlighted in the editor and listed in the Problems panel.
5. If the file is a DAO or test file, validation is skipped and an informational message is shown.

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

| Setting | Default | Description |
|---|---|---|
| `apexQueryValidator.exemptFilenameKeywords` | `["dao", "test"]` | Filename substrings that exempt a file from validation entirely (e.g. DAO and test files). |
| `apexQueryValidator.daoFilenameKeywords` | `["dao"]` | Filename substrings that identify DAO files. Used by the Quick Fix to suggest which DAO a query should be moved to. |
| `apexQueryValidator.includeGlobs` | `["**/*.cls", "**/*.trigger"]` | Glob patterns identifying which files should be validated. |
| `apexQueryValidator.diagnosticSeverity` | `"Warning"` | Severity level (`"Warning"` or `"Error"`) used for findings in the Problems panel. |
| `apexQueryValidator.autoValidate` | `true` | When `true`, validation runs automatically whenever an Apex file is opened or saved. |

## Known Limitations

- Only SOQL and SOSL queries are detected; other Apex-specific patterns are not validated.
- The extension activates when the workspace contains `.cls` or `.trigger` files. If `includeGlobs` is customized to cover other extensions, the extension may need to be triggered manually the first time.
- For SOQL queries containing subqueries (e.g. `SELECT Id, (SELECT Id FROM Contacts) FROM Account`), the DAO Quick Fix uses the first `FROM` clause found, which may point to the inner object rather than the outer one.
- The DAO Quick Fix navigates to the DAO file but does not move the query automatically — the refactoring step is left to the developer.

## Requirements

- Visual Studio Code 1.93.0 or higher.
- Works best with Salesforce Apex development environments.
