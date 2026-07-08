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
// Rule infrastructure
// ---------------------------------------------------------------------------

/**
 * A rule object shape:
 *   {
 *     id:       string,                           // e.g. 'dao/soql-placement'
 *     category: 'dao' | 'performance' | 'security' | 'style' | 'governor',
 *     check:    (text: string) => Finding[]
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
    }
];

/**
 * Run all rules whose category is enabled and return every finding.
 *
 * @param {string} text - full document text
 * @param {{ dao?: boolean, performance?: boolean, security?: boolean, style?: boolean, governor?: boolean }} enabledCategories
 * @returns {Finding[]}
 */
function runRules(text, enabledCategories = {}) {
    const findings = [];
    for (const rule of RULES) {
        if (enabledCategories[rule.category] === false) continue;
        findings.push(...rule.check(text));
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
