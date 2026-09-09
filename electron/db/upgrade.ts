import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

interface SqliteConnection {
  prepare(sql: string): { all(): Array<{ name: string }>; get(): unknown };
  pragma(sql: string, options: { simple: true }): unknown;
  backup(destination: string): Promise<unknown>;
  close(): void;
}
const Sqlite = createRequire(import.meta.url)('better-sqlite3') as new (
  file: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteConnection;

/** Online SQLite backup includes WAL data; a raw filesystem copy would not. */
export async function backupBeforeUpgrade(
  database: string,
  migrationNames: string[],
): Promise<string | null> {
  try {
    if (!(await fs.stat(database)).size) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const source = new Sqlite(database, { readonly: true, fileMustExist: true });
  try {
    if (source.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error(
        'Database integrity check failed. Existing data was not migrated.',
      );
    const hasHistory = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'",
      )
      .get();
    const applied = hasHistory
      ? source
          .prepare('SELECT name FROM migrations')
          .all()
          .map((row) => row.name)
      : [];
    if (applied.some((name) => !migrationNames.includes(name)))
      throw new Error(
        'This database belongs to a different or newer USCut version. Upgrade the app before opening it.',
      );
    if (migrationNames.every((name) => applied.includes(name))) return null;
    const directory = path.join(path.dirname(database), 'database-backups');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(
      directory,
      `before-upgrade-${Date.now()}-${randomUUID()}.sqlite`,
    );
    await source.backup(destination);
    const backup = new Sqlite(destination, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (backup.pragma('quick_check', { simple: true }) !== 'ok')
        throw new Error(
          'Database backup verification failed; upgrade stopped.',
        );
    } finally {
      backup.close();
    }
    return destination;
  } finally {
    source.close();
  }
}

export async function initializeDatabase(
  source: DataSource,
  database: string,
  migrationNames: string[],
): Promise<string | null> {
  if (source.options.synchronize || source.options.migrationsRun)
    throw new Error(
      'Database startup requires explicit, backed-up migrations.',
    );
  const backup = await backupBeforeUpgrade(database, migrationNames);
  try {
    await source.initialize();
    await source.runMigrations({ transaction: 'all' });
    const integrity = await source.query('PRAGMA quick_check');
    if (
      integrity.some(
        (row: Record<string, unknown>) => Object.values(row)[0] !== 'ok',
      )
    )
      throw new Error('Database integrity check failed after migration');
    for (const entity of source.entityMetadatas) {
      const columns: Array<{ name: string }> = await source.query(
        `PRAGMA table_info("${entity.tableName.replace(/"/g, '""')}")`,
      );
      if (
        entity.columns.some(
          (column) =>
            !columns.some((actual) => actual.name === column.databaseName),
        )
      )
        throw new Error(
          `Migration missing required columns in ${entity.tableName}`,
        );
    }
    return backup;
  } catch (error) {
    if (source.isInitialized) await source.destroy();
    throw new Error(
      `Database upgrade stopped. ${backup ? `The pre-upgrade backup is at ${backup}. ` : ''}${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
