import type { MigrationInterface, QueryRunner } from 'typeorm';
import schema from './1788955200-schema.json';

/** Frozen September 2026 schema: additive adoption of previously synchronized profiles. */
export class ProductionBaseline1788955200000 implements MigrationInterface {
  name = 'ProductionBaseline1788955200000';
  async up(runner: QueryRunner): Promise<void> {
    for (const table of schema) {
      await runner.query(
        table.sql.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS '),
      );
      const columns: Array<{ name: string }> = await runner.query(
        `PRAGMA table_info("${table.name}")`,
      );
      for (const column of table.columns) {
        if (columns.some((existing) => existing.name === column.name)) continue;
        if (column.primary)
          throw new Error(
            `Cannot safely migrate ${table.name}: missing primary key`,
          );
        await runner.query(
          `ALTER TABLE "${table.name}" ADD COLUMN ${column.definition}`,
        );
      }
      for (const index of table.indices)
        await runner.query(
          index.replace(
            /^CREATE (UNIQUE )?INDEX /,
            'CREATE $1INDEX IF NOT EXISTS ',
          ),
        );
    }
  }
  async down(): Promise<void> {
    throw new Error(
      'This adoption migration cannot be reversed without losing customer data. Restore the pre-upgrade database backup instead.',
    );
  }
}
