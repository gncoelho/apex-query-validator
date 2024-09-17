# Apex Query Validator

This Visual Studio Code extension helps enforce the DAO (Data Access Object) pattern in Salesforce projects by identifying SOQL and SOSL queries that are not located in designated DAO or Test files. It highlights queries within the opened class, trigger, or other Apex files, ensuring that your code follows best practices.

## Features

* **Query Detection**: Scans opened files for SOQL and SOSL queries.
* **Validation**: Ensures queries are located within DAO or Test files.
* **Highlighting**: Highlights queries found in non-compliant files.
* **Query Count**: Displays the number of queries found outside DAO or Test files.

## How to Use

1. Open an Apex file in Visual Studio Code.
2. Use the command palette (Ctrl+Shift+P or Cmd+Shift+P on Mac) and search for Apex Query Validator: Validate SOQL/SOSL.
3. The extension will scan the active document and highlight valid SOQL and SOSL queries.
4. If no valid queries are found, or the file is a DAO/test file, an appropriate message will be shown.

Example:

For the following Apex code:

```apex
public class MyApexClass {
    public void myMethod() {
        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Name LIKE '%Test%'];
        List<Contact> contacts = [SELECT Id, Email FROM Contact];
        String searchQuery = FIND {John} IN Name Fields RETURNING Contact(Id, Name);
    }
}
```

The extension will:

* Detect the SOQL queries: SELECT Id, Name FROM Account WHERE Name LIKE '%Test%' and SELECT Id, Email FROM Contact.
* Detect the SOSL query: FIND {John} IN Name Fields RETURNING Contact(Id, Name).
* Highlight them in the editor.
* Show a message in VS Code, e.g., "2 valid SOQL queries found. 1 valid SOSL query found."

## Commands

- Apex Query Validator: Validate SOQL/SOSL: Run validation on the active editor file. This command will check for valid SOQL and SOSL queries in the open document.

## Known Limitations

- Currently, the extension only supports validation of SOQL and SOSL queries and does not validate other Apex-specific code.

## Requirements

- Visual Studio Code 1.50.0 or higher.
- Works best when used with Apex development in Salesforce environments.