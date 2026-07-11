const SOQL_PATTERN = /\[\s*SELECT\s+.+?\s+FROM\s+\w+(?:\s+WHERE\s+.+?)?(?:\s+GROUP\s+BY\s+.+?)?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+\d+)?\s*\]/gis;
const SOSL_PATTERN = /\[\s*FIND\s+(?:'[^']*'|"[^"]*")\s+IN\s+(?:ALL|NAME|EMAIL|PHONE|SIDEBAR)\s+FIELDS\b[\s\S]*?\]/gi;

function freshRegex(pattern) {
    return new RegExp(pattern.source, pattern.flags);
}

function extractSoqlObjects(queryText) {
    const match = /\bFROM\s+(\w+)/i.exec(queryText);
    return match ? [match[1]] : [];
}

function extractSoslObjects(queryText) {
    const returningMatch = /\bRETURNING\s+([^\]]+)/i.exec(queryText);
    if (!returningMatch) return [];
    const objects = [];
    const objectPattern = /(\w+)\s*\(/g;
    let m;
    while ((m = objectPattern.exec(returningMatch[1])) !== null) {
        objects.push(m[1]);
    }
    if (objects.length === 0) {
        const simple = returningMatch[1].trim().match(/^(\w+)/);
        if (simple) objects.push(simple[1]);
    }
    return [...new Set(objects)];
}

// ---------------------------------------------------------------------------
// Performance rule helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the query text contains an aggregate function in the
 * SELECT field list (COUNT, SUM, AVG, MAX, MIN).
 */
function hasAggregate(queryText) {
    return /\bSELECT\b[\s\S]+?\b(COUNT|SUM|AVG|MAX|MIN)\s*\(/i.test(queryText);
}

/**
 * Extracts the field-list string between SELECT and FROM.
 * Returns null when the pattern cannot be matched.
 */
function extractFieldList(queryText) {
    const m = /\[\s*SELECT\s+([\s\S]+?)\s+FROM\b/i.exec(queryText);
    return m ? m[1] : null;
}

/**
 * Advances index i past a string literal starting at text[i] (either ' or ").
 * Returns the index of the closing quote, or text.length - 1 if unclosed.
 */
function skipStringLiteral(text, i) {
    const quote = text[i];
    i++;
    while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; } // escaped char
        if (text[i] === quote) return i;
        i++;
    }
    return i - 1;
}

/**
 * Returns true when the query's offset falls inside a for/while/do-while loop
 * body in the surrounding document text.
 *
 * Handles:
 *   - for (...) { ... }        — condition parens skipped, then brace range found
 *   - while (...) { ... }      — same
 *   - do { ... } while (...);  — body brace immediately follows `do`
 */
function isInsideLoop(text, queryStart) {
    const bodyStarts = [];

    // for(...){...} and while(...){...}
    const condLoopPattern = /\b(for|while)\s*\(/gi;
    let m;
    while ((m = condLoopPattern.exec(text)) !== null) {
        if (m.index >= queryStart) continue;
        let depth = 0;
        let bodyStart = -1;
        for (let j = m.index; j < text.length; j++) {
            if (text[j] === '(') { depth++; continue; }
            if (text[j] === ')') {
                depth--;
                if (depth === 0) {
                    const braceIdx = text.indexOf('{', j + 1);
                    if (braceIdx !== -1) bodyStart = braceIdx;
                    break;
                }
            }
        }
        if (bodyStart !== -1 && bodyStart < queryStart) bodyStarts.push(bodyStart);
    }

    // do{...}while(...)
    const doPattern = /\bdo\s*\{/gi;
    while ((m = doPattern.exec(text)) !== null) {
        const bodyStart = text.indexOf('{', m.index);
        if (bodyStart !== -1 && bodyStart < queryStart) bodyStarts.push(bodyStart);
    }

    for (const bodyStart of bodyStarts) {
        let braceDepth = 1;
        let bodyEnd = -1;
        for (let j = bodyStart + 1; j < text.length; j++) {
            if (text[j] === '{') braceDepth++;
            else if (text[j] === '}') {
                braceDepth--;
                if (braceDepth === 0) { bodyEnd = j; break; }
            }
        }
        if (bodyEnd !== -1 && queryStart > bodyStart && queryStart < bodyEnd) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Rule infrastructure
// ---------------------------------------------------------------------------

/**
 * A rule object shape:
 *   {
 *     id:       string,                           // e.g. 'dao/soql-placement'
 *     category: 'dao' | 'performance' | 'security' | 'style' | 'governor',
 *     check:    (text: string, options?: object) => Finding[]
 *   }
 *
 * A Finding object shape:
 *   {
 *     ruleId:   string,
 *     category: string,
 *     message:  string,
 *     start:    number,   // character offset in document text
 *     end:      number,
 *     type:     string,   // 'SOQL' | 'SOSL' | rule-specific label (for back-compat)
 *     objects:  string[]  // SObject names (may be empty)
 *   }
 */

const RULES = [
    // --- DAO placement -------------------------------------------------------
    {
        id: 'dao/soql-placement',
        category: 'dao',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                findings.push({
                    ruleId: 'dao/soql-placement',
                    category: 'dao',
                    message: 'SOQL query should be moved to a DAO class.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(m[0])
                });
            }
            return findings;
        }
    },
    {
        id: 'dao/sosl-placement',
        category: 'dao',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOSL_PATTERN))) {
                findings.push({
                    ruleId: 'dao/sosl-placement',
                    category: 'dao',
                    message: 'SOSL query should be moved to a DAO class.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOSL',
                    objects: extractSoslObjects(m[0])
                });
            }
            return findings;
        }
    },

    // --- Performance ---------------------------------------------------------
    {
        id: 'perf/missing-limit',
        category: 'performance',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                if (/\bLIMIT\b/i.test(q)) continue;
                if (hasAggregate(q)) continue;
                findings.push({
                    ruleId: 'perf/missing-limit',
                    category: 'performance',
                    message: 'SOQL query has no LIMIT clause — this may return up to 50,000 rows and hit governor limits.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },
    {
        id: 'perf/wide-field-list',
        category: 'performance',
        check(text, options = {}) {
            const maxFields = options.maxSelectFields != null ? options.maxSelectFields : 10;
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const fieldList = extractFieldList(m[0]);
                if (!fieldList) continue;
                const count = fieldList.split(',').length;
                if (count <= maxFields) continue;
                findings.push({
                    ruleId: 'perf/wide-field-list',
                    category: 'performance',
                    message: `SOQL query selects ${count} fields — consider selecting only the fields you need (threshold: ${maxFields}).`,
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(m[0])
                });
            }
            return findings;
        }
    },
    {
        id: 'perf/soql-in-loop',
        category: 'performance',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                if (!isInsideLoop(text, m.index)) continue;
                findings.push({
                    ruleId: 'perf/soql-in-loop',
                    category: 'performance',
                    message: 'SOQL query is inside a loop — this can quickly exhaust the 100 SOQL queries per transaction governor limit.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(m[0])
                });
            }
            return findings;
        }
    },
    {
        id: 'perf/unbounded-large-object',
        category: 'performance',
        check(text, options = {}) {
            const largeObjects = options.largeObjects != null
                ? options.largeObjects
                : ['ContentDocument', 'ContentVersion', 'Task', 'Event', 'EmailMessage', 'FeedItem'];
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                if (/\bWHERE\b/i.test(q)) continue;
                const objects = extractSoqlObjects(q);
                const matched = objects.find(o =>
                    largeObjects.some(large => large.toLowerCase() === o.toLowerCase())
                );
                if (!matched) continue;
                findings.push({
                    ruleId: 'perf/unbounded-large-object',
                    category: 'performance',
                    message: `SOQL query on '${matched}' has no WHERE clause — querying this object without a filter can be very slow or hit row limits.`,
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects
                });
            }
            return findings;
        }
    },
    {
        id: 'perf/order-by-no-limit',
        category: 'performance',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                if (!/\bORDER\s+BY\b/i.test(q)) continue;
                if (/\bLIMIT\b/i.test(q)) continue;
                findings.push({
                    ruleId: 'perf/order-by-no-limit',
                    category: 'performance',
                    message: 'SOQL query uses ORDER BY without a LIMIT clause — add LIMIT to avoid sorting an unbounded result set.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },

    // --- Security ------------------------------------------------------------
    {
        id: 'security/dynamic-soql-concat',
        category: 'security',
        check(text) {
            const findings = [];
            // Match Database.query( and scan forward to find the matching closing
            // paren, skipping string literals so a ) inside a string doesn't close
            // the depth counter early. Then check whether any + operator appears
            // outside of string literals in the argument.
            const callPattern = /Database\s*\.\s*query\s*\(/gi;
            let m;
            while ((m = callPattern.exec(text)) !== null) {
                const argStart = m.index + m[0].length;
                let depth = 1;
                let argEnd = -1;
                let hasConcat = false;
                for (let i = argStart; i < text.length; i++) {
                    const ch = text[i];
                    if (ch === '\'' || ch === '"') { i = skipStringLiteral(text, i); continue; }
                    if (ch === '(') { depth++; continue; }
                    if (ch === ')') {
                        depth--;
                        if (depth === 0) { argEnd = i; break; }
                        continue;
                    }
                    if (ch === '+') hasConcat = true;
                }
                if (argEnd === -1 || !hasConcat) continue;
                findings.push({
                    ruleId: 'security/dynamic-soql-concat',
                    category: 'security',
                    message: 'Database.query() argument uses string concatenation — this is a SOQL injection risk. Use bind variables instead.',
                    start: m.index,
                    end: argEnd + 1,
                    type: 'dynamic-soql',
                    objects: []
                });
            }
            return findings;
        }
    },
    {
        id: 'security/hardcoded-id',
        category: 'security',
        check(text) {
            const findings = [];
            // Salesforce ID: 15 or 18 alphanumeric characters enclosed in single quotes.
            // Uses a combined pattern that first tries 18 chars then 15 to avoid
            // the 15-char match always winning over the 18-char one.
            const idPattern = /'([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})'/g;
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const whereMatch = /\bWHERE\b([\s\S]*)/i.exec(q);
                if (!whereMatch) continue;
                const whereClause = whereMatch[1];
                idPattern.lastIndex = 0;
                let idMatch;
                // Absolute offset of the start of the WHERE clause content within the document
                const whereClauseOffset = m.index + whereMatch.index + (whereMatch[0].length - whereClause.length);
                while ((idMatch = idPattern.exec(whereClause)) !== null) {
                    const id = idMatch[1];
                    if (id.length !== 15 && id.length !== 18) continue;
                    const idStart = whereClauseOffset + idMatch.index;
                    findings.push({
                        ruleId: 'security/hardcoded-id',
                        category: 'security',
                        message: `Hardcoded Salesforce ID '${id}' found in WHERE clause — use a named constant or variable instead so this works across orgs.`,
                        start: idStart,
                        end: idStart + idMatch[0].length,
                        type: 'SOQL',
                        objects: extractSoqlObjects(q)
                    });
                }
            }
            return findings;
        }
    },
    {
        id: 'security/user-input-in-where',
        category: 'security',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const whereMatch = /\bWHERE\b([\s\S]*)/i.exec(q);
                if (!whereMatch) continue;
                // Strip bind-variable values (e.g. :myVar) from the WHERE clause
                // so they don't mask adjacent string literals that are still unbound.
                const whereClauseStripped = whereMatch[1].replace(/:\s*\w+/g, '');
                // If any string literal remains after stripping bind vars, flag it
                if (!/'[^']*'/.test(whereClauseStripped)) continue;
                findings.push({
                    ruleId: 'security/user-input-in-where',
                    category: 'security',
                    severity: 'information',
                    message: 'SOQL WHERE clause contains an inline string literal with no bind variable — consider using :variable syntax to prevent injection.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },

    // --- Style ---------------------------------------------------------------
    {
        id: 'style/select-id-only',
        category: 'style',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const fieldList = extractFieldList(m[0]);
                if (!fieldList) continue;
                if (fieldList.trim().toLowerCase() !== 'id') continue;
                findings.push({
                    ruleId: 'style/select-id-only',
                    category: 'style',
                    message: 'SOQL query selects only Id — consider whether additional fields are needed to avoid a follow-up query.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(m[0])
                });
            }
            return findings;
        }
    },
    {
        id: 'style/aggregate-missing-group-by',
        category: 'style',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const fieldList = extractFieldList(q);
                if (!fieldList) continue;
                if (!/\b(COUNT|SUM|AVG|MAX|MIN)\s*\(/i.test(fieldList)) continue;
                if (/\bGROUP\s+BY\b/i.test(q)) continue;
                findings.push({
                    ruleId: 'style/aggregate-missing-group-by',
                    category: 'style',
                    message: 'SOQL query uses an aggregate function without a GROUP BY clause — add GROUP BY or use COUNT() alone.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },
    {
        id: 'style/sosl-no-returning',
        category: 'style',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOSL_PATTERN))) {
                if (/\bRETURNING\b/i.test(m[0])) continue;
                findings.push({
                    ruleId: 'style/sosl-no-returning',
                    category: 'style',
                    message: 'SOSL query has no RETURNING clause — without it all accessible objects and fields are returned, which is rarely intentional in production code.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOSL',
                    objects: []
                });
            }
            return findings;
        }
    },
    {
        id: 'style/sosl-sidebar-scope',
        category: 'style',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOSL_PATTERN))) {
                if (!/\bIN\s+SIDEBAR\s+FIELDS\b/i.test(m[0])) continue;
                findings.push({
                    ruleId: 'style/sosl-sidebar-scope',
                    category: 'style',
                    message: 'SOSL query uses the deprecated SIDEBAR search scope — replace it with ALL, NAME, EMAIL, or PHONE FIELDS.',
                    start: m.index,
                    end: m.index + m[0].length,
                    type: 'SOSL',
                    objects: extractSoslObjects(m[0])
                });
            }
            return findings;
        }
    },

    // --- Governor limits -----------------------------------------------------
    {
        id: 'governor/too-many-queries',
        category: 'governor',
        check(text, options = {}) {
            const max = options.maxQueriesPerFile != null ? options.maxQueriesPerFile : 5;
            let count = 0;
            // eslint-disable-next-line no-unused-vars
            for (const _soql of text.matchAll(freshRegex(SOQL_PATTERN))) count++;
            // eslint-disable-next-line no-unused-vars
            for (const _sosl of text.matchAll(freshRegex(SOSL_PATTERN))) count++;
            if (count <= max) return [];
            return [{
                ruleId: 'governor/too-many-queries',
                category: 'governor',
                message: `File contains ${count} inline SOQL/SOSL queries (threshold: ${max}) — consider consolidating queries to stay within the 100 queries per transaction limit.`,
                start: 0,
                end: 0,
                type: 'governor',
                objects: []
            }];
        }
    },
    {
        id: 'governor/dynamic-soql-call',
        category: 'governor',
        check(text) {
            const findings = [];
            const callPattern = /Database\s*\.\s*query\s*\(/gi;
            let m;
            while ((m = callPattern.exec(text)) !== null) {
                const argStart = m.index + m[0].length;
                let depth = 1;
                let argEnd = argStart;
                for (let i = argStart; i < text.length; i++) {
                    if (text[i] === '(') depth++;
                    else if (text[i] === ')') {
                        depth--;
                        if (depth === 0) { argEnd = i; break; }
                    }
                }
                findings.push({
                    ruleId: 'governor/dynamic-soql-call',
                    category: 'governor',
                    message: 'Database.query() call detected — dynamic SOQL bypasses bracket-query detection and still counts against the 100 SOQL governor limit.',
                    start: m.index,
                    end: argEnd + 1,
                    type: 'dynamic-soql',
                    objects: []
                });
            }
            return findings;
        }
    },
    {
        id: 'governor/dynamic-sosl-call',
        category: 'governor',
        check(text) {
            const findings = [];
            const callPattern = /(?:Search\s*\.\s*query|Database\s*\.\s*search)\s*\(/gi;
            let m;
            while ((m = callPattern.exec(text)) !== null) {
                const argStart = m.index + m[0].length;
                let depth = 1;
                let argEnd = argStart;
                for (let i = argStart; i < text.length; i++) {
                    if (text[i] === '(') depth++;
                    else if (text[i] === ')') {
                        depth--;
                        if (depth === 0) { argEnd = i; break; }
                    }
                }
                findings.push({
                    ruleId: 'governor/dynamic-sosl-call',
                    category: 'governor',
                    message: 'Dynamic SOSL call detected — Search.query() / Database.search() bypasses bracket-query detection and still counts against governor limits.',
                    start: m.index,
                    end: argEnd + 1,
                    type: 'dynamic-sosl',
                    objects: []
                });
            }
            return findings;
        }
    }
];

// ---------------------------------------------------------------------------
// Inline suppression
// ---------------------------------------------------------------------------
//
// Developers can silence an intentional finding without disabling a whole
// category, using ESLint-style comments:
//
//   // aqv-disable-next-line perf/missing-limit   -> next line only
//   [SELECT Id FROM Account]
//
//   [SELECT Id FROM Account] // aqv-disable-line style/select-id-only, perf/missing-limit
//
//   // aqv-disable security                        -> whole file (by category)
//
// A directive with no ids listed suppresses every rule for that scope. Ids may
// be rule ids (e.g. perf/missing-limit) or categories (e.g. performance) and
// are separated by whitespace/commas. Text after ` -- ` is treated as a reason
// and ignored.

/** Returns an array of the character offset at which each 0-indexed line starts. */
function buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return starts;
}

/** Maps a character offset to its 0-indexed line number via binary search. */
function offsetToLine(lineStarts, pos) {
    let lo = 0, hi = lineStarts.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineStarts[mid] <= pos) { ans = mid; lo = mid + 1; }
        else { hi = mid - 1; }
    }
    return ans;
}

/**
 * Parses all suppression directives out of the document.
 * Returns `{ file: Entry[], byLine: Map<lineNumber, Entry[]> }` where an Entry is
 * `{ all: boolean, ids: Set<string> }`.
 */
function collectSuppressions(text, lineStarts) {
    const file = [];
    const byLine = new Map();
    const directive = /\/\/\s*aqv-disable(-next-line|-line)?\b[ \t]*([^\n]*)/gi;
    let m;
    while ((m = directive.exec(text)) !== null) {
        const kind = m[1] ? m[1].toLowerCase() : '';
        const rest = (m[2] || '').split(' -- ')[0];
        const ids = rest.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
        const entry = { all: ids.length === 0, ids: new Set(ids) };
        if (kind === '') {
            file.push(entry);
        } else {
            const commentLine = offsetToLine(lineStarts, m.index);
            const targetLine = kind === '-next-line' ? commentLine + 1 : commentLine;
            if (!byLine.has(targetLine)) byLine.set(targetLine, []);
            byLine.get(targetLine).push(entry);
        }
    }
    return { file, byLine };
}

function suppressionMatches(entry, finding) {
    return entry.all || entry.ids.has(finding.ruleId) || entry.ids.has(finding.category);
}

/** True when a suppression directive silences the given finding. */
function isFindingSuppressed(finding, suppressions, lineStarts) {
    for (const entry of suppressions.file) {
        if (suppressionMatches(entry, finding)) return true;
    }
    const entries = suppressions.byLine.get(offsetToLine(lineStarts, finding.start));
    if (entries) {
        for (const entry of entries) {
            if (suppressionMatches(entry, finding)) return true;
        }
    }
    return false;
}

/**
 * Run all rules whose category is enabled and return every finding, minus any
 * silenced by inline suppression comments.
 *
 * @param {string} text - full document text
 * @param {{ dao?: boolean, performance?: boolean, security?: boolean, style?: boolean, governor?: boolean }} enabledCategories
 * @param {object} [options] - rule options (e.g. maxSelectFields, largeObjects, ruleOverrides)
 * @returns {Finding[]}
 *
 * `options.ruleOverrides` maps a rule id to "off" | "information" | "warning" |
 * "error" and takes precedence over the category toggle: "off" disables the
 * rule; any severity value forces it to run even when its category is disabled.
 */
function runRules(text, enabledCategories = {}, options = {}) {
    const overrides = options.ruleOverrides || {};
    const findings = [];
    for (const rule of RULES) {
        const override = overrides[rule.id];
        if (override === 'off') continue;
        if (override == null && enabledCategories[rule.category] === false) continue;
        findings.push(...rule.check(text, options));
    }

    const lineStarts = buildLineStarts(text);
    const suppressions = collectSuppressions(text, lineStarts);
    if (!suppressions.file.length && !suppressions.byLine.size) return findings;
    return findings.filter(f => !isFindingSuppressed(f, suppressions, lineStarts));
}

// ---------------------------------------------------------------------------
// Legacy public API — preserved so existing callers and tests are unaffected
// ---------------------------------------------------------------------------

function findQueries(text) {
    return runRules(text, { dao: true, performance: false, security: false, style: false, governor: false }).map(f => ({
        type: f.type,
        match: text.slice(f.start, f.end),
        start: f.start,
        end: f.end,
        objects: f.objects
    }));
}

function isExemptFile(fileName, exemptKeywords) {
    const lowerName = fileName.toLowerCase();
    return exemptKeywords.some(keyword => lowerName.includes(keyword.toLowerCase()));
}

function isDaoFile(fileName, daoKeywords) {
    const lowerName = fileName.toLowerCase();
    return daoKeywords.some(k => lowerName.includes(k.toLowerCase()));
}

function globToRegExp(glob) {
    const escaped = glob
        .split('')
        .map(char => '*?'.includes(char) ? char : char.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('')
        .replace(/\*\*/g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/ /g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`${escaped}$`, 'i');
}

function matchesGlob(fileName, globs) {
    const normalized = fileName.replace(/\\/g, '/');
    return globs.some(glob => globToRegExp(glob).test(normalized));
}

function buildSummaryMessage(soqlCount, soslCount) {
    let message = '';

    message += soqlCount > 0
        ? `${soqlCount} SOQL ${soqlCount === 1 ? 'query' : 'queries'} found that should be moved to a DAO class.\n`
        : 'No SOQL queries found.\n';

    message += soslCount > 0
        ? `${soslCount} SOSL ${soslCount === 1 ? 'query' : 'queries'} found that should be moved to a DAO class.\n`
        : 'No SOSL queries found.\n';

    return message;
}

function buildWorkspaceSummaryMessage(fileCount, soqlCount, soslCount) {
    const filePart = `${fileCount} ${fileCount === 1 ? 'file' : 'files'} scanned.`;
    const soqlPart = soqlCount > 0
        ? `${soqlCount} SOQL ${soqlCount === 1 ? 'query' : 'queries'} found that should be moved to a DAO class.`
        : 'No SOQL queries found.';
    const soslPart = soslCount > 0
        ? `${soslCount} SOSL ${soslCount === 1 ? 'query' : 'queries'} found that should be moved to a DAO class.`
        : 'No SOSL queries found.';
    return `${filePart} ${soqlPart} ${soslPart}`;
}

module.exports = {
    SOQL_PATTERN,
    SOSL_PATTERN,
    RULES,
    runRules,
    // Exported helpers (used in tests and for extension consumers)
    hasAggregate,
    extractFieldList,
    skipStringLiteral,
    isInsideLoop,
    buildLineStarts,
    offsetToLine,
    collectSuppressions,
    extractSoqlObjects,
    extractSoslObjects,
    findQueries,
    isExemptFile,
    isDaoFile,
    globToRegExp,
    matchesGlob,
    buildSummaryMessage,
    buildWorkspaceSummaryMessage
};
