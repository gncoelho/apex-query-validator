const vscode = require('vscode');
const path = require('path');
const {
    runRules, isExemptFile, isDaoFile, extractSoqlObjects, extractSoslObjects,
    matchesGlob, buildSummaryMessage, buildWorkspaceSummaryMessage
} = require('./validator');

const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 255, 0, 0.2)',
    border: '1px solid yellow'
});

// Base URL for per-rule documentation. When set, diagnostic codes become
// clickable links to the matching anchor; until docs anchors exist, keep it
// null so the code is the plain rule id string (still usable as a stable key).
const DOC_BASE_URL = null;

function getConfig() {
    const config = vscode.workspace.getConfiguration('apexQueryValidator');
    return {
        exemptKeywords: config.get('exemptFilenameKeywords'),
        includeGlobs: config.get('includeGlobs'),
        severity: config.get('diagnosticSeverity') === 'Error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        autoValidate: config.get('autoValidate'),
        daoKeywords: config.get('daoFilenameKeywords'),
        enablePerformanceRules: config.get('enablePerformanceRules'),
        enableSecurityRules: config.get('enableSecurityRules'),
        enableStyleRules: config.get('enableStyleRules'),
        enableGovernorRules: config.get('enableGovernorRules'),
        maxSelectFields: config.get('maxSelectFields'),
        largeObjects: config.get('largeObjects'),
        maxQueriesPerFile: config.get('maxQueriesPerFile')
    };
}

function clearDocument(document, diagnosticCollection) {
    diagnosticCollection.delete(document.uri);
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === document.uri.toString());
    if (editor) {
        editor.setDecorations(decorationType, []);
    }
}

function applyDocumentValidation(document, diagnosticCollection, {
    severity,
    enablePerformanceRules,
    enableSecurityRules,
    enableStyleRules,
    enableGovernorRules,
    maxSelectFields,
    largeObjects,
    maxQueriesPerFile
}) {
    const text = document.getText();
    const findings = runRules(text, {
        dao: true,
        performance: enablePerformanceRules,
        security: enableSecurityRules,
        style: enableStyleRules,
        governor: enableGovernorRules
    }, { maxSelectFields, largeObjects, maxQueriesPerFile });

    const diagnostics = findings.map(({ ruleId, message, start, end, category, severity: findingSeverity }) => {
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        const diagSeverity = (category === 'style' || findingSeverity === 'information')
            ? vscode.DiagnosticSeverity.Information
            : severity;
        const diag = new vscode.Diagnostic(range, message, diagSeverity);
        diag.source = 'apexQueryValidator';
        // Expose the rule id so it appears in the Problems panel and gives Quick
        // Fixes / suppression / per-rule config a stable key to target.
        if (ruleId) {
            diag.code = DOC_BASE_URL
                ? { value: ruleId, target: vscode.Uri.parse(`${DOC_BASE_URL}#${ruleId.replace('/', '')}`) }
                : ruleId;
        }
        return diag;
    });
    diagnosticCollection.set(document.uri, diagnostics);

    const editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === document.uri.toString()
    );
    if (editor) {
        editor.setDecorations(decorationType, findings.map(({ start, end }) => ({
            range: new vscode.Range(document.positionAt(start), document.positionAt(end))
        })));
    }

    return {
        soqlCount: findings.filter(f => f.type === 'SOQL').length,
        soslCount: findings.filter(f => f.type === 'SOSL').length
    };
}

function runValidation(document, diagnosticCollection, { silent }) {
    const { exemptKeywords, includeGlobs, severity, autoValidate,
        enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules,
        maxSelectFields, largeObjects, maxQueriesPerFile } = getConfig();

    if (!matchesGlob(document.fileName, includeGlobs)) {
        clearDocument(document, diagnosticCollection);
        return;
    }

    if (isExemptFile(document.fileName, exemptKeywords)) {
        clearDocument(document, diagnosticCollection);
        if (!silent) {
            vscode.window.showInformationMessage('Validation skipped for DAO or test files');
        }
        return;
    }

    if (silent && !autoValidate) {
        return;
    }

    const { soqlCount, soslCount } = applyDocumentValidation(document, diagnosticCollection, {
        severity, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules,
        maxSelectFields, largeObjects, maxQueriesPerFile
    });

    if (!silent) {
        vscode.window.showInformationMessage(buildSummaryMessage(soqlCount, soslCount));
    }
}

// Returns true when it is safe to delete diagnostics on close (URI is not workspace-validated).
// Exported for testing.
function shouldClearOnClose(uriString, workspaceValidatedUris) {
    return !workspaceValidatedUris.has(uriString);
}

async function validateWorkspace(diagnosticCollection, workspaceValidatedUris) {
    const { exemptKeywords, includeGlobs, severity,
        enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules,
        maxSelectFields, largeObjects, maxQueriesPerFile } = getConfig();

    // Reset tracked URIs so a re-run starts clean.
    workspaceValidatedUris.clear();

    const uriSets = await Promise.all(includeGlobs.map(glob => vscode.workspace.findFiles(glob)));
    const seen = new Set();
    const uris = [];
    for (const batch of uriSets) {
        for (const uri of batch) {
            const key = uri.toString();
            if (!seen.has(key)) { seen.add(key); uris.push(uri); }
        }
    }

    let totalSoql = 0, totalSosl = 0, fileCount = 0;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validating workspace...', cancellable: false },
        async () => {
            for (const uri of uris) {
                const document = await vscode.workspace.openTextDocument(uri);
                if (!matchesGlob(document.fileName, includeGlobs)) continue;
                if (isExemptFile(document.fileName, exemptKeywords)) continue;
                const { soqlCount, soslCount } = applyDocumentValidation(document, diagnosticCollection, {
                    severity, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules,
                    maxSelectFields, largeObjects, maxQueriesPerFile
                });
                // Track this URI so onDidCloseTextDocument does not wipe its diagnostics.
                workspaceValidatedUris.add(uri.toString());
                totalSoql += soqlCount;
                totalSosl += soslCount;
                fileCount++;
            }
        }
    );

    vscode.window.showInformationMessage(buildWorkspaceSummaryMessage(fileCount, totalSoql, totalSosl));
}

// Finds DAO files in the workspace whose name contains one of the given SObject names.
// Exported for testing.
async function findDaoFilesForObjects(objectNames, { daoKeywords, includeGlobs }) {
    if (!objectNames.length || !daoKeywords.length) return [];

    const uriSets = await Promise.all(includeGlobs.map(g => vscode.workspace.findFiles(g)));
    const seen = new Set();
    const results = [];

    for (const batch of uriSets) {
        for (const uri of batch) {
            const key = uri.toString();
            if (seen.has(key)) continue;
            seen.add(key);

            const baseName = path.basename(uri.fsPath);
            if (!isDaoFile(baseName, daoKeywords)) continue;

            const lowerName = baseName.toLowerCase();
            const hasObjectMatch = objectNames.some(obj => lowerName.includes(obj.toLowerCase()));
            if (hasObjectMatch) results.push(uri);
        }
    }

    return results;
}

class DaoSuggestionProvider {
    async provideCodeActions(document, _range, context) {
        const ourDiagnostics = context.diagnostics.filter(d => d.source === 'apexQueryValidator');
        if (!ourDiagnostics.length) return [];

        const { daoKeywords, includeGlobs } = getConfig();
        const actions = [];
        const suggestedUris = new Set();

        for (const diagnostic of ourDiagnostics) {
            const queryText = document.getText(diagnostic.range);
            const objects = [
                ...extractSoqlObjects(queryText),
                ...extractSoslObjects(queryText)
            ];

            const daoUris = await findDaoFilesForObjects(objects, { daoKeywords, includeGlobs });

            for (const uri of daoUris) {
                const uriKey = uri.toString();
                if (suggestedUris.has(uriKey)) continue;
                suggestedUris.add(uriKey);

                const label = path.basename(uri.fsPath);
                const action = new vscode.CodeAction(`Open ${label}`, vscode.CodeActionKind.QuickFix);
                action.command = { command: 'vscode.open', title: `Open ${label}`, arguments: [uri] };
                action.diagnostics = [diagnostic];
                actions.push(action);
            }
        }

        return actions;
    }
}

function activate(context) {
    console.log('"apex-query-validator" extension is active!');

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('apexQueryValidator');
    const workspaceValidatedUris = new Set();

    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(decorationType);

    const disposable = vscode.commands.registerCommand('apex-query-validator.validateSoqlSosl', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        runValidation(editor.document, diagnosticCollection, { silent: false });
    });
    context.subscriptions.push(disposable);

    const workspaceDisposable = vscode.commands.registerCommand(
        'apex-query-validator.validateWorkspace',
        function () { return validateWorkspace(diagnosticCollection, workspaceValidatedUris); }
    );
    context.subscriptions.push(workspaceDisposable);

    const daoProviderDisposable = vscode.languages.registerCodeActionsProvider(
        [{ scheme: 'file', pattern: '**/*.cls' }, { scheme: 'file', pattern: '**/*.trigger' }],
        new DaoSuggestionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    );
    context.subscriptions.push(daoProviderDisposable);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        runValidation(document, diagnosticCollection, { silent: true });
    }));

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
        runValidation(document, diagnosticCollection, { silent: true });
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        if (shouldClearOnClose(document.uri.toString(), workspaceValidatedUris)) {
            diagnosticCollection.delete(document.uri);
        }
    }));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    shouldClearOnClose,
    findDaoFilesForObjects
};
