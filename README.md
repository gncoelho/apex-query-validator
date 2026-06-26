# Apex Query Validator

This Visual Studio Code extension helps enforce the DAO (Data Access Object) pattern in Salesforce projects by identifying SOQL and SOSL queries that are not located in designated DAO or Test files. It highlights queries within the opened class, trigger, or other Apex files, ensuring that your code follows best practices.

## Features

* **Query Detection**: Scans Apex files (`.cls`/`.trigger` by default) for SOQL and SOSL queries.
* **Validation**: Flags queries located outside of DAO or Test files as violations.
* **Highlighting**: Highlights flagged queries in the editor.
* **Problems Panel**: Reports flagged queries as diagnostics in the VS Code Problems panel.
* **Automatic Validation**: Runs automatically when an Apex file is opened or saved (configurable), in addition to the manual command.
* **Query Count**: Displays the number of queries found outside DAO or Test files.

## How to Use

1. Open an Apex file in Visual Studio Code.
2. Validation runs automatically on open/save, or use the command palette (Ctrl+Shift+P or Cmd+Shift+P on Mac) and search for Apex Query Validator: Validate SOQL/SOSL to run it manually.
3. The extension will scan the document, highlight flagged SOQL/SOSL queries, and list them in the Problems panel.
4. If no queries are found, or the file is a DAO/test file, an appropriate message will be shown (for the manual command).

Example:

For the following Apex code:

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

* Detect the SOQL queries: `[SELECT Id, Name FROM Account WHERE Name LIKE '%Test%']` and `[SELECT Id, Email FROM Contact]`.
* Detect the SOSL query: `[FIND 'John' IN NAME FIELDS RETURNING Contact(Id, Name)]`.
* Highlight them in the editor and list them in the Problems panel.
* Show a message in VS Code, e.g., "2 SOQL queries found that should be moved to a DAO class. 1 SOSL query found that should be moved to a DAO class."

## Commands

- Apex Query Validator: Validate SOQL/SOSL: Run validation on the active editor file. This command will check for SOQL and SOSL queries in the open document.

## Settings

- `apexQueryValidator.exemptFilenameKeywords` (default: `["dao", "test"]`): Lowercase filename substrings that exempt a file from validation.
- `apexQueryValidator.includeGlobs` (default: `["**/*.cls", "**/*.trigger"]`): Glob patterns identifying which files should be validated.
- `apexQueryValidator.diagnosticSeverity` (default: `"Warning"`): Severity (`Warning` or `Error`) used for findings in the Problems panel.
- `apexQueryValidator.autoValidate` (default: `true`): Automatically validate on file open/save, in addition to the manual command.

## Known Limitations

- Currently, the extension only supports validation of SOQL and SOSL queries and does not validate other Apex-specific code.
- The extension activates when a workspace contains `.cls`/`.trigger` files. If `includeGlobs` is customized to other extensions, the extension may need to be triggered manually via the command the first time, since activation is not re-derived from that setting.

## Requirements

- Visual Studio Code 1.93.0 or higher.
- Works best when used with Apex development in Salesforce environments.