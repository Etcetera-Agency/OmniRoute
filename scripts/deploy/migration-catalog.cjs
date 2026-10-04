'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function compareIds(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function failure() {
  return {
    integrityOk: false,
    foreignKeyViolationCount: -1,
    migrationCoverageOk: false,
  };
}

function inspect(databasePath) {
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const integrity = database.pragma('integrity_check', { simple: true });
    const foreignKeys = database.pragma('foreign_key_check');
    const sourceDirectory = path.join(process.cwd(), 'migrations');
    const sourceIds = fs.readdirSync(sourceDirectory)
      .map((filename) => filename.match(/^(\d+)_.*\.sql$/))
      .filter(Boolean)
      .map((match) => match[1])
      .sort(compareIds);
    const ledgerIds = database.prepare(
      'SELECT version FROM _omniroute_migrations'
    ).all()
      .map((row) => String(row.version))
      .filter((version) => /^\d+$/.test(version))
      .sort(compareIds);

    return {
      integrityOk: integrity === 'ok',
      foreignKeyViolationCount: foreignKeys.length,
      migrationCoverageOk: sourceIds.length === ledgerIds.length &&
        sourceIds.every((id, index) => id === ledgerIds[index]),
    };
  } catch (_error) {
    return failure();
  } finally {
    if (database) database.close();
  }
}

const result = inspect(process.argv[2]);
process.stdout.write(JSON.stringify(result) + '\n');
