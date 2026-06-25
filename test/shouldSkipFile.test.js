const assert = require('assert');
const { shouldSkipFile } = require('../extension');

suite('shouldSkipFile', () => {
    test('skips a filename containing "dao" (lowercase)', () => {
        assert.strictEqual(shouldSkipFile('AccountDao.cls'), true);
    });

    test('skips a filename containing "DAO" (uppercase)', () => {
        assert.strictEqual(shouldSkipFile('AccountDAO.cls'), true);
    });

    test('skips a filename containing "test" (lowercase)', () => {
        assert.strictEqual(shouldSkipFile('accountservicetest.cls'), true);
    });

    test('skips a filename containing "Test" (mixed case)', () => {
        assert.strictEqual(shouldSkipFile('AccountServiceTest.cls'), true);
    });

    test('does not skip a normal filename', () => {
        assert.strictEqual(shouldSkipFile('AccountService.cls'), false);
    });
});
