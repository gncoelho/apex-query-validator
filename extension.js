const vscode = require('vscode');
const path = require('path');
const {
    runRules, isExemptFile, isDaoFile, extractSoqlObjects, extractSoslObjects,
    matchesGlob, buildSummaryMessage, buildWorkspaceSummaryMessage, buildWorkspaceCancelledMessage,
    splitTopLevelConcat, isConcatSegmentSafe, buildDaoMethod, buildMetadataIndex, countQueriesByType,
    getRuleCategories, buildSingleCategoryMap, buildCategorySummaryMessage, buildCategoryCancelledMessage
} = require('./validator');

// Human-readable labels for each rule category (keys come from getRuleCategories()).
const CATEGORY_LABELS = {
    dao: 'DAO Placement',
    correctness: 'Correctness',
    performance: 'Performance',
    security: 'Security',
    style: 'Style',
    governor: 'Governor Limits',
    metadata: 'Metadata'
};
const { STANDARD_OBJECTS, COMMON_STANDARD_FIELDS } = require('./metadata-baseline');

// Cached offline object/field index, rebuilt lazily and invalidated by a
// FileSystemWatcher on the SFDX metadata files.
let metadataIndexCache = null;

async function getMetadataIndex() {
    if (metadataIndexCache) return metadataIndexCache;
    const [objectUris, fieldUris] = await Promise.all([
        vscode.workspace.findFiles('**/objects/**/*.object-meta.xml'),
        vscode.workspace.findFiles('**/objects/**/fields/*.field-meta.xml')
    ]);
    metadataIndexCache = buildMetadataIndex(
        objectUris.map(u => u.fsPath),
        fieldUris.map(u => u.fsPath),
        { standardObjects: STANDARD_OBJECTS, standardFields: COMMON_STANDARD_FIELDS }
    );
    return metadataIndexCache;
}

function invalidateMetadataIndex() {
    metadataIndexCache = null;
}

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
        enableCorrectnessRules: config.get('enableCorrectnessRules'),
        enablePerformanceRules: config.get('enablePerformanceRules'),
        enableSecurityRules: config.get('enableSecurityRules'),
        enableStyleRules: config.get('enableStyleRules'),
        enableGovernorRules: config.get('enableGovernorRules'),
        enableMetadataRules: config.get('enableMetadataRules'),
        maxSelectFields: config.get('maxSelectFields'),
        largeObjects: config.get('largeObjects'),
        maxQueriesPerFile: config.get('maxQueriesPerFile'),
        maxSubqueries: config.get('maxSubqueries'),
        enforceSecurityClause: config.get('enforceSecurityClause'),
        quickFixLimit: config.get('quickFixLimit'),
        ruleOverrides: config.get('rules') || {}
    };
}

// Maps a per-rule override string to a vscode severity, or null when the value
// does not name a concrete severity ("off" / undefined / unknown).
function severityFromString(value) {
    switch (value) {
        case 'error': return vscode.DiagnosticSeverity.Error;
        case 'warning': return vscode.DiagnosticSeverity.Warning;
        case 'information': return vscode.DiagnosticSeverity.Information;
        default: return null;
    }
}

// Resolves the severity for a finding.
// Precedence: per-rule override > style/informational default > global severity.
// Exported for testing.
function resolveSeverity(finding, { ruleOverrides = {}, defaultSeverity }) {
    const overridden = severityFromString(ruleOverrides[finding.ruleId]);
    if (overridden !== null) return overridden;
    if (finding.category === 'style' || finding.severity === 'information') {
        return vscode.DiagnosticSeverity.Information;
    }
    return defaultSeverity;
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
    enableCorrectnessRules,
    enablePerformanceRules,
    enableSecurityRules,
    enableStyleRules,
    enableGovernorRules,
    enableMetadataRules,
    maxSelectFields,
    largeObjects,
    maxQueriesPerFile,
    maxSubqueries,
    enforceSecurityClause,
    metadataIndex,
    ruleOverrides = {},
    categoryFilter = null
}) {
    const text = document.getText();
    const categories = categoryFilter
        ? buildSingleCategoryMap(categoryFilter)
        : {
            dao: true,
            correctness: enableCorrectnessRules,
            performance: enablePerformanceRules,
            security: enableSecurityRules,
            style: enableStyleRules,
            governor: enableGovernorRules,
            metadata: enableMetadataRules
        };
    const findings = runRules(text, categories, { maxSelectFields, largeObjects, maxQueriesPerFile, maxSubqueries, enforceSecurityClause, metadataIndex, ruleOverrides });

    const diagnostics = findings.map(({ ruleId, message, start, end, category, severity: findingSeverity }) => {
        const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
        const diagSeverity = resolveSeverity(
            { ruleId, category, severity: findingSeverity },
            { ruleOverrides, defaultSeverity: severity }
        );
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

    return { ...countQueriesByType(findings), total: findings.length };
}

// True when the metadata index is needed: a targeted metadata run, or an
// "all rules" run with the metadata category enabled.
function needsMetadataIndex(categoryFilter, enableMetadataRules) {
    return categoryFilter ? categoryFilter === 'metadata' : enableMetadataRules;
}

async function runValidation(document, diagnosticCollection, { silent, categoryFilter = null }) {
    const { exemptKeywords, includeGlobs, severity, autoValidate,
        enableCorrectnessRules, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules, enableMetadataRules,
        maxSelectFields, largeObjects, maxQueriesPerFile, maxSubqueries, enforceSecurityClause, ruleOverrides } = getConfig();

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

    const metadataIndex = needsMetadataIndex(categoryFilter, enableMetadataRules) ? await getMetadataIndex() : null;

    const { soqlCount, soslCount, total } = applyDocumentValidation(document, diagnosticCollection, {
        severity, enableCorrectnessRules, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules, enableMetadataRules,
        maxSelectFields, largeObjects, maxQueriesPerFile, maxSubqueries, enforceSecurityClause, metadataIndex, ruleOverrides, categoryFilter
    });

    if (!silent) {
        vscode.window.showInformationMessage(
            categoryFilter
                ? buildCategorySummaryMessage(CATEGORY_LABELS[categoryFilter], 1, total)
                : buildSummaryMessage(soqlCount, soslCount)
        );
    }
}

// Returns true when it is safe to delete diagnostics on close (URI is not workspace-validated).
// Exported for testing.
function shouldClearOnClose(uriString, workspaceValidatedUris) {
    return !workspaceValidatedUris.has(uriString);
}

async function validateWorkspace(diagnosticCollection, workspaceValidatedUris, { categoryFilter = null } = {}) {
    const { exemptKeywords, includeGlobs, severity,
        enableCorrectnessRules, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules, enableMetadataRules,
        maxSelectFields, largeObjects, maxQueriesPerFile, maxSubqueries, enforceSecurityClause, ruleOverrides } = getConfig();

    const metadataIndex = needsMetadataIndex(categoryFilter, enableMetadataRules) ? await getMetadataIndex() : null;

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

    let totalSoql = 0, totalSosl = 0, totalFindings = 0, fileCount = 0;
    let cancelled = false;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Validating workspace...', cancellable: true },
        async (progress, token) => {
            for (let i = 0; i < uris.length; i++) {
                // Stop before the next file when the user cancels. Diagnostics
                // already set for scanned files are intentionally kept.
                if (token && token.isCancellationRequested) { cancelled = true; break; }
                progress.report({ increment: 100 / uris.length, message: `${i + 1} of ${uris.length} files` });

                const uri = uris[i];
                const document = await vscode.workspace.openTextDocument(uri);
                if (!matchesGlob(document.fileName, includeGlobs)) continue;
                if (isExemptFile(document.fileName, exemptKeywords)) continue;
                const { soqlCount, soslCount, total } = applyDocumentValidation(document, diagnosticCollection, {
                    severity, enableCorrectnessRules, enablePerformanceRules, enableSecurityRules, enableStyleRules, enableGovernorRules, enableMetadataRules,
                    maxSelectFields, largeObjects, maxQueriesPerFile, maxSubqueries, enforceSecurityClause, metadataIndex, ruleOverrides, categoryFilter
                });
                // Track this URI so onDidCloseTextDocument does not wipe its diagnostics.
                workspaceValidatedUris.add(uri.toString());
                totalSoql += soqlCount;
                totalSosl += soslCount;
                totalFindings += total;
                fileCount++;
            }
        }
    );

    const label = categoryFilter ? CATEGORY_LABELS[categoryFilter] : null;
    vscode.window.showInformationMessage(
        categoryFilter
            ? (cancelled
                ? buildCategoryCancelledMessage(label, fileCount, totalFindings)
                : buildCategorySummaryMessage(label, fileCount, totalFindings))
            : (cancelled
                ? buildWorkspaceCancelledMessage(fileCount, totalSoql, totalSosl)
                : buildWorkspaceSummaryMessage(fileCount, totalSoql, totalSosl))
    );
}

// Two-step Quick Pick: pick a validation (a category or "All rules"), then a
// scope (active file or whole project), then run it. Exported for testing.
async function runValidationMenu(diagnosticCollection, workspaceValidatedUris) {
    const categoryItems = [
        { label: 'All rules', categoryKey: null },
        ...getRuleCategories().map(key => ({ label: CATEGORY_LABELS[key] || key, categoryKey: key }))
    ];
    const categoryPick = await vscode.window.showQuickPick(categoryItems, { placeHolder: 'Select a validation to run' });
    if (!categoryPick) return;

    const scopePick = await vscode.window.showQuickPick(
        [{ label: 'Active file', scope: 'file' }, { label: 'Whole project', scope: 'workspace' }],
        { placeHolder: 'Select scope' }
    );
    if (!scopePick) return;

    if (scopePick.scope === 'file') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showErrorMessage('No active editor!'); return; }
        return runValidation(editor.document, diagnosticCollection, { silent: false, categoryFilter: categoryPick.categoryKey });
    }
    return validateWorkspace(diagnosticCollection, workspaceValidatedUris, { categoryFilter: categoryPick.categoryKey });
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

// Extracts the rule id carried on a diagnostic's `code` (string or {value}).
function diagnosticRuleId(diagnostic) {
    const code = diagnostic.code;
    return (code && typeof code === 'object') ? code.value : code;
}

// Builds a single-range text-replacement Quick Fix.
function makeReplaceAction(title, document, range, newText, diagnostic) {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, range, newText);
    action.diagnostics = [diagnostic];
    return action;
}

// Inserts a trailing clause (e.g. `LIMIT 200`) into a bracket query, before an
// existing OFFSET when present, otherwise just before the closing `]`.
function insertTailClause(queryText, clause) {
    const offsetIdx = queryText.search(/\s+OFFSET\b/i);
    if (offsetIdx !== -1) {
        return queryText.slice(0, offsetIdx) + ' ' + clause + queryText.slice(offsetIdx);
    }
    const closeIdx = queryText.lastIndexOf(']');
    if (closeIdx === -1) return null;
    return queryText.slice(0, closeIdx).replace(/\s+$/, '') + ' ' + clause + queryText.slice(closeIdx);
}

// Inserts `WITH SECURITY_ENFORCED` after any WHERE conditions but before
// GROUP BY / ORDER BY / LIMIT / OFFSET (or the closing `]`).
function insertSecurityClause(queryText) {
    const m = /\s+(GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET)\b/i.exec(queryText);
    if (m) {
        return queryText.slice(0, m.index) + ' WITH SECURITY_ENFORCED' + queryText.slice(m.index);
    }
    const closeIdx = queryText.lastIndexOf(']');
    if (closeIdx === -1) return null;
    return queryText.slice(0, closeIdx).replace(/\s+$/, '') + ' WITH SECURITY_ENFORCED' + queryText.slice(closeIdx);
}

function addLimitFix(document, diagnostic) {
    const text = document.getText(diagnostic.range);
    if (/\bLIMIT\b/i.test(text)) return [];
    const limit = getConfig().quickFixLimit || 200;
    const replaced = insertTailClause(text, `LIMIT ${limit}`);
    if (!replaced || replaced === text) return [];
    return [makeReplaceAction(`Add LIMIT ${limit}`, document, diagnostic.range, replaced, diagnostic)];
}

// Wraps every unsafe concatenated segment of a dynamic query argument in
// String.escapeSingleQuotes(...). The diagnostic range spans the whole call.
function escapeConcatFix(document, diagnostic) {
    const text = document.getText(diagnostic.range);
    const openIdx = text.indexOf('(');
    const closeIdx = text.lastIndexOf(')');
    if (openIdx === -1 || closeIdx <= openIdx) return [];
    const arg = text.slice(openIdx + 1, closeIdx);
    const segments = splitTopLevelConcat(arg);
    if (segments.length < 2) return [];
    const wrapped = segments.map(s => isConcatSegmentSafe(s) ? s : `String.escapeSingleQuotes(${s})`);
    const newText = text.slice(0, openIdx + 1) + wrapped.join(' + ') + text.slice(closeIdx);
    if (newText === text) return [];
    return [makeReplaceAction('Wrap variables in String.escapeSingleQuotes()', document, diagnostic.range, newText, diagnostic)];
}

// Extracts a hardcoded Salesforce Id literal into a class constant and replaces
// the literal with a reference to it. Requires an enclosing class (returns no
// fix for triggers or class-less snippets).
function extractHardcodedIdFix(document, diagnostic) {
    const literal = document.getText(diagnostic.range);
    const whole = document.getText();
    const classMatch = /\bclass\b[^{]*\{/i.exec(whole);
    if (!classMatch) return [];
    const constName = 'RECORD_ID';
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, constName);
    const insertPos = document.positionAt(classMatch.index + classMatch[0].length);
    edit.insert(document.uri, insertPos, `\n    private static final Id ${constName} = ${literal};`);
    const action = new vscode.CodeAction('Extract hardcoded Id to a constant', vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.diagnostics = [diagnostic];
    return [action];
}

// Registry of per-rule Quick Fixes, keyed by rule id. Each factory returns
// CodeAction[] for a single diagnostic. Exported for testing.
const QUICK_FIXES = {
    'style/sosl-sidebar-scope': (document, diagnostic) => {
        const text = document.getText(diagnostic.range);
        const replaced = text.replace(/\bSIDEBAR\b/i, 'ALL');
        if (replaced === text) return [];
        return [makeReplaceAction('Replace SIDEBAR with ALL FIELDS', document, diagnostic.range, replaced, diagnostic)];
    },
    'perf/missing-limit': addLimitFix,
    'perf/order-by-no-limit': addLimitFix,
    'correctness/single-row-no-limit': (document, diagnostic) => {
        const text = document.getText(diagnostic.range);
        const replaced = /\bLIMIT\s+\d+/i.test(text)
            ? text.replace(/\bLIMIT\s+\d+/i, 'LIMIT 1')
            : insertTailClause(text, 'LIMIT 1');
        if (!replaced || replaced === text) return [];
        return [makeReplaceAction('Add LIMIT 1', document, diagnostic.range, replaced, diagnostic)];
    },
    'security/missing-security-enforced': (document, diagnostic) => {
        const text = document.getText(diagnostic.range);
        const replaced = insertSecurityClause(text);
        if (!replaced || replaced === text) return [];
        return [makeReplaceAction('Add WITH SECURITY_ENFORCED', document, diagnostic.range, replaced, diagnostic)];
    },
    'security/dynamic-soql-concat': escapeConcatFix,
    'security/dynamic-sosl-concat': escapeConcatFix,
    'security/hardcoded-id': extractHardcodedIdFix
};

class QueryQuickFixProvider {
    async provideCodeActions(document, _range, context) {
        const ourDiagnostics = context.diagnostics.filter(d => d.source === 'apexQueryValidator');
        if (!ourDiagnostics.length) return [];

        const actions = [];

        // Registered per-rule Quick Fixes.
        for (const diagnostic of ourDiagnostics) {
            const factory = QUICK_FIXES[diagnosticRuleId(diagnostic)];
            if (factory) actions.push(...factory(document, diagnostic));
        }

        // DAO navigation suggestions (existing behavior).
        actions.push(...await buildDaoNavigationActions(document, ourDiagnostics));

        return actions;
    }
}

async function buildDaoNavigationActions(document, ourDiagnostics) {
    const { daoKeywords, includeGlobs } = getConfig();
    const actions = [];
    const navigatedUris = new Set();

    for (const diagnostic of ourDiagnostics) {
        const queryText = document.getText(diagnostic.range);
        const objects = [
            ...extractSoqlObjects(queryText),
            ...extractSoslObjects(queryText)
        ];

        const daoUris = await findDaoFilesForObjects(objects, { daoKeywords, includeGlobs });
        const isPlacement = /placement$/.test(String(diagnosticRuleId(diagnostic) || ''));

        for (const uri of daoUris) {
            const label = path.basename(uri.fsPath);

            // Navigation suggestion (deduped per DAO file).
            if (!navigatedUris.has(uri.toString())) {
                navigatedUris.add(uri.toString());
                const nav = new vscode.CodeAction(`Open ${label}`, vscode.CodeActionKind.QuickFix);
                nav.command = { command: 'vscode.open', title: `Open ${label}`, arguments: [uri] };
                nav.diagnostics = [diagnostic];
                actions.push(nav);
            }

            // Method-stub generation, only for an inline bracket placement finding.
            if (isPlacement && queryText.trim().startsWith('[')) {
                const genAction = await buildDaoMethodAction(document, diagnostic, uri);
                if (genAction) actions.push(genAction);
            }
        }
    }

    return actions;
}

// Builds a multi-file edit that appends a DAO method wrapping the query and
// replaces the inline query at the call site with a call to it. Exported for testing.
async function buildDaoMethodAction(document, diagnostic, daoUri) {
    const queryText = document.getText(diagnostic.range);
    const objects = [...extractSoqlObjects(queryText), ...extractSoslObjects(queryText)];
    const { methodName, code } = buildDaoMethod(queryText, objects[0] || null);

    const daoDoc = await vscode.workspace.openTextDocument(daoUri);
    const daoText = daoDoc.getText();
    const closeIdx = daoText.lastIndexOf('}');
    if (closeIdx === -1) return null;

    const daoClassName = path.basename(daoUri.fsPath).replace(/\.(cls|trigger)$/i, '');
    const edit = new vscode.WorkspaceEdit();
    edit.insert(daoUri, daoDoc.positionAt(closeIdx), code);
    edit.replace(document.uri, diagnostic.range, `${daoClassName}.${methodName}()`);

    const action = new vscode.CodeAction(
        `Move query to ${methodName}() in ${path.basename(daoUri.fsPath)}`,
        vscode.CodeActionKind.QuickFix
    );
    action.edit = edit;
    action.diagnostics = [diagnostic];
    return action;
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

    // Per-category "Validate <Category>" commands (active file).
    for (const key of getRuleCategories()) {
        context.subscriptions.push(vscode.commands.registerCommand(`apex-query-validator.validate.${key}`, function () {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor!');
                return;
            }
            return runValidation(editor.document, diagnosticCollection, { silent: false, categoryFilter: key });
        }));
    }

    // "Run a Validation…" menu command (choose category + scope).
    context.subscriptions.push(vscode.commands.registerCommand(
        'apex-query-validator.runValidation',
        function () { return runValidationMenu(diagnosticCollection, workspaceValidatedUris); }
    ));

    const daoProviderDisposable = vscode.languages.registerCodeActionsProvider(
        [{ scheme: 'file', pattern: '**/*.cls' }, { scheme: 'file', pattern: '**/*.trigger' }],
        new QueryQuickFixProvider(),
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

    // Invalidate the cached metadata index when object/field files change.
    const metadataWatcher = vscode.workspace.createFileSystemWatcher('**/objects/**/*-meta.xml');
    metadataWatcher.onDidCreate(invalidateMetadataIndex);
    metadataWatcher.onDidChange(invalidateMetadataIndex);
    metadataWatcher.onDidDelete(invalidateMetadataIndex);
    context.subscriptions.push(metadataWatcher);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    shouldClearOnClose,
    findDaoFilesForObjects,
    resolveSeverity,
    diagnosticRuleId,
    QUICK_FIXES,
    buildDaoMethodAction,
    getMetadataIndex,
    invalidateMetadataIndex,
    CATEGORY_LABELS
};
