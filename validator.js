const SOQL_PATTERN = /\[\s*SELECT\s+.+?\s+FROM\s+\w+(?:\s+WHERE\s+.+?)?(?:\s+WITH\s+.+?)?(?:\s+GROUP\s+BY\s+.+?)?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+\d+)?(?:\s+OFFSET\s+\d+)?\s*\]/gis;
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
 * Returns the FIELDS() macro form used in a query — 'ALL', 'STANDARD', or
 * 'CUSTOM' — or null when none is present. ALL and CUSTOM are "unbounded" and
 * require a bounded LIMIT; STANDARD is bounded.
 */
function fieldsMacroType(queryText) {
    const m = /\bFIELDS\s*\(\s*(ALL|STANDARD|CUSTOM)\s*\)/i.exec(queryText);
    return m ? m[1].toUpperCase() : null;
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
// Correctness rule helpers
// ---------------------------------------------------------------------------

/** True when a declared type is a collection (so a query into it returns many rows). */
function isCollectionType(type) {
    if (/\[\s*\]$/.test(type)) return true; // Account[]
    return /^(List|Set|Map|Iterable)\b/i.test(type.trim());
}

/**
 * Determines whether a bracket query at [queryStart, queryEnd) is consumed in a
 * single-row context — i.e. assigned to a single (non-collection) SObject
 * variable (`Account a = [...]`) or immediately indexed (`[...][0]`).
 *
 * Deliberately conservative: it only reports `singleRow: true` for a clear
 * `Type ident =` declaration or a trailing `[0]`, so returns, reassignments,
 * `new Map<>([...])`, and SOQL for-loops (`for (Account a : [...])`) are not
 * flagged.
 */
function getAssignmentContext(text, queryStart, queryEnd) {
    // `[...][0]` — single-row access by index.
    if (/^\s*\[\s*0\s*\]/.test(text.slice(queryEnd))) return { singleRow: true };

    const before = text.slice(0, queryStart);
    const stmtStart = Math.max(
        before.lastIndexOf(';'),
        before.lastIndexOf('{'),
        before.lastIndexOf('}')
    );
    const fragment = before.slice(stmtStart + 1).trim();
    const m = /^(.+?)\s+\w+\s*=$/.exec(fragment);
    if (!m) return { singleRow: false };
    if (isCollectionType(m[1])) return { singleRow: false };
    return { singleRow: true };
}

// ---------------------------------------------------------------------------
// Dynamic-query helpers
// ---------------------------------------------------------------------------

// Every dynamic query/search entry point. `*WithBinds` variants pass a bind map
// and are marked `isBinds: true` (they are the safe form).
const DYNAMIC_QUERY_METHODS = [
    { object: 'Database', method: 'query',                    kind: 'soql', isBinds: false },
    { object: 'Database', method: 'getQueryLocator',          kind: 'soql', isBinds: false },
    { object: 'Database', method: 'countQuery',               kind: 'soql', isBinds: false },
    { object: 'Database', method: 'queryWithBinds',           kind: 'soql', isBinds: true },
    { object: 'Database', method: 'getQueryLocatorWithBinds', kind: 'soql', isBinds: true },
    { object: 'Database', method: 'countQueryWithBinds',      kind: 'soql', isBinds: true },
    { object: 'Search',   method: 'query',                    kind: 'sosl', isBinds: false },
    { object: 'Database', method: 'search',                   kind: 'sosl', isBinds: false }
];

function lookupDynamicMethod(object, method) {
    const o = object.toLowerCase();
    const me = method.toLowerCase();
    return DYNAMIC_QUERY_METHODS.find(d => d.object.toLowerCase() === o && d.method.toLowerCase() === me);
}

// Method names ordered longest-first so the alternation prefers, e.g.,
// `queryWithBinds` over `query`.
const DYNAMIC_CALL_PATTERN = /\b(Database|Search)\s*\.\s*(getQueryLocatorWithBinds|countQueryWithBinds|queryWithBinds|getQueryLocator|countQuery|query|search)\s*\(/gi;

/**
 * Finds every dynamic query/search call site in the text. For each returns
 * `{ kind, method, isBinds, callStart, argStart, argEnd, argText }` where
 * `argEnd` is the index of the matching close paren (or -1 if unterminated) and
 * `argText` is the argument source (string literals left intact).
 */
function findDynamicQueryCalls(text) {
    const results = [];
    const pattern = freshRegex(DYNAMIC_CALL_PATTERN);
    let m;
    while ((m = pattern.exec(text)) !== null) {
        const meta = lookupDynamicMethod(m[1], m[2]);
        if (!meta) continue; // e.g. Search.getQueryLocator — not a real combination
        const argStart = m.index + m[0].length;
        let depth = 1, argEnd = -1;
        for (let i = argStart; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\'' || ch === '"') { i = skipStringLiteral(text, i); continue; }
            if (ch === '(') { depth++; continue; }
            if (ch === ')') { depth--; if (depth === 0) { argEnd = i; break; } }
        }
        results.push({
            kind: meta.kind,
            method: `${m[1]}.${m[2]}`,
            isBinds: meta.isBinds,
            callStart: m.index,
            argStart,
            argEnd,
            argText: argEnd === -1 ? text.slice(argStart) : text.slice(argStart, argEnd)
        });
    }
    return results;
}

/** True when a `+` (concatenation) appears outside string literals in the argument. */
function hasUnquotedPlus(argText) {
    for (let i = 0; i < argText.length; i++) {
        const ch = argText[i];
        if (ch === '\'' || ch === '"') { i = skipStringLiteral(argText, i); continue; }
        if (ch === '+') return true;
    }
    return false;
}

/** Splits an argument into its top-level `+`-concatenated segments (ignoring +'s inside strings/parens). */
function splitTopLevelConcat(argText) {
    const segments = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < argText.length; i++) {
        const ch = argText[i];
        if (ch === '\'' || ch === '"') { i = skipStringLiteral(argText, i); continue; }
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { depth--; continue; }
        if (ch === '+' && depth === 0) {
            segments.push(argText.slice(start, i));
            start = i + 1;
        }
    }
    segments.push(argText.slice(start));
    return segments.map(s => s.trim());
}

/** A concatenated segment is safe when it is a string literal or a String.escapeSingleQuotes(...) call. */
function isConcatSegmentSafe(segment) {
    if (segment === '') return true;
    if (/^'(?:\\.|[^'\\])*'$/.test(segment) || /^"(?:\\.|[^"\\])*"$/.test(segment)) return true;
    if (/^String\s*\.\s*escapeSingleQuotes\s*\(/i.test(segment) && segment.endsWith(')')) return true;
    return false;
}

/**
 * True when the argument concatenates at least one unsafe (unescaped, non-literal)
 * segment — i.e. a genuine injection risk. Fully-escaped or literal-only
 * concatenations return false.
 */
function hasUnsafeConcat(argText) {
    const segments = splitTopLevelConcat(argText);
    if (segments.length < 2) return false; // no concatenation
    return segments.some(s => !isConcatSegmentSafe(s));
}

/**
 * Returns a copy of the text in which every dynamic query whose argument is a
 * single string literal (e.g. `Database.query('SELECT ...')`) has that literal's
 * surrounding quotes swapped for `[` and `]` — presenting it as a bracket query
 * so the bracket-based rules apply to it. Only single characters are swapped, so
 * every offset is preserved. Concatenated / multi-argument / bind calls are left
 * untouched.
 */
function bracketizeStaticDynamicQueries(text) {
    let chars = null;
    for (const call of findDynamicQueryCalls(text)) {
        if (call.argEnd === -1) continue;
        const literal = call.argText.trim();
        if (!/^'(?:\\.|[^'\\])*'$/.test(literal) && !/^"(?:\\.|[^"\\])*"$/.test(literal)) continue;
        const quote = literal[0];
        const openRel = call.argText.indexOf(quote);
        const closeRel = call.argText.lastIndexOf(quote);
        if (openRel === closeRel) continue;
        if (!chars) chars = text.split('');
        chars[call.argStart + openRel] = '[';
        chars[call.argStart + closeRel] = ']';
    }
    return chars ? chars.join('') : text;
}

// Rules that scan for dynamic query CALL SITES (not bracket queries) must see the
// original text so their string-literal-aware paren walking stays correct; all
// other (bracket-query) rules see the bracketized text.
const DYNAMIC_CALL_RULE_IDS = new Set([
    'governor/dynamic-soql-call',
    'governor/dynamic-sosl-call',
    'security/dynamic-soql-concat',
    'security/dynamic-sosl-concat'
]);

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

    // --- Correctness ---------------------------------------------------------
    {
        id: 'correctness/single-row-no-limit',
        category: 'correctness',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const end = m.index + q.length;
                // LIMIT 1 makes the single-row intent safe.
                if (/\bLIMIT\s+1\b/i.test(q)) continue;
                if (!getAssignmentContext(text, m.index, end).singleRow) continue;
                findings.push({
                    ruleId: 'correctness/single-row-no-limit',
                    category: 'correctness',
                    message: 'SOQL query result is used as a single record without LIMIT 1 — this throws a QueryException if it returns 0 or more than 1 row. Add LIMIT 1.',
                    start: m.index,
                    end,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },
    {
        id: 'correctness/offset-too-large',
        category: 'correctness',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const offsetMatch = /\bOFFSET\s+(\d+)/i.exec(q);
                if (!offsetMatch) continue;
                const value = parseInt(offsetMatch[1], 10);
                if (value <= 2000) continue;
                findings.push({
                    ruleId: 'correctness/offset-too-large',
                    category: 'correctness',
                    message: `SOQL OFFSET of ${value} exceeds the maximum of 2000 — this throws a runtime error. Reduce OFFSET or switch to keyset (Id-based) pagination.`,
                    start: m.index,
                    end: m.index + q.length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
                });
            }
            return findings;
        }
    },
    {
        id: 'correctness/sosl-min-length',
        category: 'correctness',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOSL_PATTERN))) {
                const q = m[0];
                const termMatch = /FIND\s+(?:'([^']*)'|"([^"]*)")/i.exec(q);
                if (!termMatch) continue; // bind term (FIND :x) — not a literal
                const term = termMatch[1] !== undefined ? termMatch[1] : termMatch[2];
                // Wildcards do not count toward the 2-character minimum.
                if (term.replace(/[*?]/g, '').length >= 2) continue;
                findings.push({
                    ruleId: 'correctness/sosl-min-length',
                    category: 'correctness',
                    message: `SOSL search term '${term}' is shorter than the 2-character minimum — this throws a runtime error.`,
                    start: m.index,
                    end: m.index + q.length,
                    type: 'SOSL',
                    objects: extractSoslObjects(q)
                });
            }
            return findings;
        }
    },
    {
        id: 'correctness/fields-macro-needs-limit',
        category: 'correctness',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const macro = fieldsMacroType(q);
                // Only the unbounded forms require a bounded LIMIT.
                if (macro !== 'ALL' && macro !== 'CUSTOM') continue;
                const limitMatch = /\bLIMIT\s+(\d+)/i.exec(q);
                if (limitMatch && parseInt(limitMatch[1], 10) <= 200) continue;
                const reason = limitMatch ? `a LIMIT of ${limitMatch[1]}` : 'no LIMIT';
                findings.push({
                    ruleId: 'correctness/fields-macro-needs-limit',
                    category: 'correctness',
                    message: `FIELDS(${macro}) requires a LIMIT of 200 or fewer, but this query has ${reason} — it will fail to run.`,
                    start: m.index,
                    end: m.index + q.length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
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

    {
        id: 'perf/non-selective-filter',
        category: 'performance',
        check(text) {
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                const whereMatch = /\bWHERE\b([\s\S]*)/i.exec(q);
                if (!whereMatch) continue;
                const where = whereMatch[1];
                const reasons = [];
                if (/\bLIKE\s+'%/i.test(where)) reasons.push("leading-wildcard LIKE '%...'");
                if (/\bNOT\s+LIKE\b/i.test(where)) reasons.push('NOT LIKE');
                if (/\bNOT\s+IN\b/i.test(where)) reasons.push('NOT IN');
                if (/!=|<>/.test(where)) reasons.push('!= / <>');
                if (!reasons.length) continue;
                findings.push({
                    ruleId: 'perf/non-selective-filter',
                    category: 'performance',
                    severity: 'information',
                    message: `SOQL WHERE clause uses a non-selective filter (${reasons.join(', ')}) — it cannot use an index and may scan many rows.`,
                    start: m.index,
                    end: m.index + q.length,
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
            for (const call of findDynamicQueryCalls(text)) {
                if (call.kind !== 'soql' || call.isBinds) continue;
                if (call.argEnd === -1 || !hasUnsafeConcat(call.argText)) continue;
                findings.push({
                    ruleId: 'security/dynamic-soql-concat',
                    category: 'security',
                    message: `${call.method}() argument uses unescaped string concatenation — this is a SOQL injection risk. Use bind variables or String.escapeSingleQuotes().`,
                    start: call.callStart,
                    end: call.argEnd + 1,
                    type: 'dynamic-soql',
                    objects: []
                });
            }
            return findings;
        }
    },
    {
        id: 'security/dynamic-sosl-concat',
        category: 'security',
        check(text) {
            const findings = [];
            for (const call of findDynamicQueryCalls(text)) {
                if (call.kind !== 'sosl' || call.isBinds) continue;
                if (call.argEnd === -1 || !hasUnsafeConcat(call.argText)) continue;
                findings.push({
                    ruleId: 'security/dynamic-sosl-concat',
                    category: 'security',
                    message: `${call.method}() argument uses unescaped string concatenation — this is a SOSL injection risk. Wrap user input in String.escapeSingleQuotes().`,
                    start: call.callStart,
                    end: call.argEnd + 1,
                    type: 'dynamic-sosl',
                    objects: []
                });
            }
            return findings;
        }
    },
    {
        id: 'security/missing-security-enforced',
        category: 'security',
        check(text, options = {}) {
            // Opt-in: opinionated, so only runs when explicitly enabled.
            if (options.enforceSecurityClause !== true) return [];
            const findings = [];
            for (const m of text.matchAll(freshRegex(SOQL_PATTERN))) {
                const q = m[0];
                if (/\bWITH\s+(SECURITY_ENFORCED|USER_MODE|SYSTEM_MODE)\b/i.test(q)) continue;
                findings.push({
                    ruleId: 'security/missing-security-enforced',
                    category: 'security',
                    message: 'SOQL query does not enforce field/object security — add WITH SECURITY_ENFORCED or WITH USER_MODE (or WITH SYSTEM_MODE to opt out explicitly).',
                    start: m.index,
                    end: m.index + q.length,
                    type: 'SOQL',
                    objects: extractSoqlObjects(q)
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
            for (const call of findDynamicQueryCalls(text)) {
                if (call.kind !== 'soql') continue;
                findings.push({
                    ruleId: 'governor/dynamic-soql-call',
                    category: 'governor',
                    message: `${call.method}() is a dynamic SOQL call — it bypasses bracket-query detection and still counts against the 100 SOQL queries governor limit.`,
                    start: call.callStart,
                    end: (call.argEnd === -1 ? text.length : call.argEnd + 1),
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
            for (const call of findDynamicQueryCalls(text)) {
                if (call.kind !== 'sosl') continue;
                findings.push({
                    ruleId: 'governor/dynamic-sosl-call',
                    category: 'governor',
                    message: `${call.method}() is a dynamic SOSL call — it bypasses bracket-query detection and still counts against governor limits.`,
                    start: call.callStart,
                    end: (call.argEnd === -1 ? text.length : call.argEnd + 1),
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
    const scanText = bracketizeStaticDynamicQueries(text);
    const findings = [];
    for (const rule of RULES) {
        const override = overrides[rule.id];
        if (override === 'off') continue;
        if (override == null && enabledCategories[rule.category] === false) continue;
        const ruleText = DYNAMIC_CALL_RULE_IDS.has(rule.id) ? text : scanText;
        findings.push(...rule.check(ruleText, options));
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
    return runRules(text, { dao: true, correctness: false, performance: false, security: false, style: false, governor: false }).map(f => ({
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
    fieldsMacroType,
    skipStringLiteral,
    isInsideLoop,
    buildLineStarts,
    offsetToLine,
    collectSuppressions,
    isCollectionType,
    getAssignmentContext,
    findDynamicQueryCalls,
    hasUnquotedPlus,
    splitTopLevelConcat,
    isConcatSegmentSafe,
    hasUnsafeConcat,
    bracketizeStaticDynamicQueries,
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
