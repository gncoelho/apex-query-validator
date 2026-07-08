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
 * Returns true when the query's offset falls inside a for/while loop body
 * in the surrounding document text.
 *
 * Strategy: find all loop keyword positions before the query, then for each
 * (innermost first) walk forward matching parens to find the body brace, then
 * walk the braces to find the body end. If the query offset falls inside,
 * return true.
 */
function isInsideLoop(text, queryStart) {
    const loopPattern = /\b(for|while)\s*\(/gi;
    let m;
    const loopStarts = [];
    while ((m = loopPattern.exec(text)) !== null) {
        if (m.index < queryStart) loopStarts.push(m.index);
    }

    for (let i = loopStarts.length - 1; i >= 0; i--) {
        const loopKeywordPos = loopStarts[i];
        // Skip over the condition parentheses to find the body opening brace
        let depth = 0;
        let bodyStart = -1;
        for (let j = loopKeywordPos; j < text.length; j++) {
            if (text[j] === '(') { depth++; continue; }
            if (text[j] === ')') {
                depth--;
                if (depth === 0) {
                    const braceIdx = text.indexOf('{', j + 1);
                    if (braceIdx !== -1) bodyStart = braceIdx;
                    break;
                }
                continue;
            }
        }
        if (bodyStart === -1 || bodyStart >= queryStart) continue;

        // Walk brace depth to find the body closing brace
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
    }
];

/**
 * Run all rules whose category is enabled and return every finding.
 *
 * @param {string} text - full document text
 * @param {{ dao?: boolean, performance?: boolean, security?: boolean, style?: boolean, governor?: boolean }} enabledCategories
 * @param {object} [options] - rule options (e.g. maxSelectFields, largeObjects)
 * @returns {Finding[]}
 */
function runRules(text, enabledCategories = {}, options = {}) {
    const findings = [];
    for (const rule of RULES) {
        if (enabledCategories[rule.category] === false) continue;
        findings.push(...rule.check(text, options));
    }
    return findings;
}

// ---------------------------------------------------------------------------
// Legacy public API — preserved so existing callers and tests are unaffected
// ---------------------------------------------------------------------------

function findQueries(text) {
    return runRules(text, { dao: true }).map(f => ({
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
    extractSoqlObjects,
    extractSoslObjects,
    findQueries,
    isExemptFile,
    isDaoFile,
    matchesGlob,
    buildSummaryMessage,
    buildWorkspaceSummaryMessage
};
