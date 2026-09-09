import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { databaseEntities } from '../entities';
import * as migrations from '../migrations';
import { initializeDatabase, backupBeforeUpgrade } from '../upgrade';

const migrationTypes = Object.values(migrations);
const names = migrationTypes.map((Migration) => new Migration().name);
function source(database: string) {
  return new DataSource({
    type: 'better-sqlite3',
    database,
    entities: databaseEntities,
    migrations: migrationTypes,
    synchronize: false,
    migrationsRun: false,
  });
}
async function run() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'uscut-db-upgrade-'),
  );
  const connections: DataSource[] = [];
  const open = (db: DataSource) => {
    connections.push(db);
    return db;
  };
  try {
    const cleanPath = path.join(directory, 'clean.sqlite');
    const clean = open(source(cleanPath));
    assert.equal(await initializeDatabase(clean, cleanPath, names), null);
    assert.equal(await clean.showMigrations(), false);
    await clean.query(
      "INSERT INTO mas_property_listing (id,source,address,city,state,capturedAt) VALUES ('listing','manual','Example','Example','TX',CURRENT_TIMESTAMP)",
    );
    assert.equal(
      (await clean.query('SELECT photoCaptions FROM mas_property_listing'))[0]
        .photoCaptions,
      '[]',
    );
    await clean.destroy();
    const reopened = open(source(cleanPath));
    assert.equal(await initializeDatabase(reopened, cleanPath, names), null);
    assert.equal(
      (await reopened.query('SELECT id FROM mas_property_listing'))[0].id,
      'listing',
    );
    console.log(
      'PASS: clean install creates complete schema; repeat launch does not rerun or rebackup migrations.',
    );

    const oldPath = path.join(directory, 'old.sqlite');
    const old = open(
      new DataSource({
        type: 'better-sqlite3',
        database: oldPath,
        migrations: migrationTypes.filter(
          (Migration) => !new Migration().name.startsWith('ProductionBaseline'),
        ),
        migrationsRun: true,
      }),
    );
    await old.initialize();
    await old.query(
      "INSERT INTO user (id,name,phone,loginTime) VALUES ('u','Customer','',CURRENT_TIMESTAMP)",
    );
    await old.query(
      "INSERT INTO account (userId,type,loginCookie,uid,account,avatar,nickname) VALUES ('u','xhs','fixture-cookie','uid','customer','','Customer')",
    );
    await old.query('PRAGMA journal_mode=WAL');
    await old.query('PRAGMA wal_autocheckpoint=0');
    await old.query(
      "INSERT INTO mas_content_asset (id,platform,body) VALUES ('content','facebook','Keep this draft')",
    );
    const before = await backupBeforeUpgrade(oldPath, names);
    assert.ok(before);
    const backup = open(
      new DataSource({ type: 'better-sqlite3', database: before }),
    );
    await backup.initialize();
    assert.equal(
      (await backup.query('SELECT body FROM mas_content_asset'))[0].body,
      'Keep this draft',
    );
    await backup.destroy();
    await old.destroy();
    const upgraded = open(source(oldPath));
    assert.ok(await initializeDatabase(upgraded, oldPath, names));
    assert.equal(
      (await upgraded.query('SELECT groupId,loginCookie FROM account'))[0]
        .loginCookie,
      'fixture-cookie',
    );
    assert.equal(
      (await upgraded.query('SELECT groupId FROM account'))[0].groupId,
      1,
    );
    assert.equal(
      (await upgraded.query('SELECT body FROM mas_content_asset'))[0].body,
      'Keep this draft',
    );
    console.log(
      'PASS: historical migrations upgrade with customer rows preserved; verified online backup includes uncheckpointed WAL writes.',
    );

    const syncedPath = path.join(directory, 'synchronized.sqlite');
    const synced = open(
      new DataSource({
        type: 'better-sqlite3',
        database: syncedPath,
        entities: databaseEntities,
        synchronize: true,
      }),
    );
    await synced.initialize();
    await synced.query(
      "INSERT INTO mas_content_asset (id,platform,body) VALUES ('sync','facebook','Synchronized profile')",
    );
    await synced.destroy();
    const adopted = open(source(syncedPath));
    assert.ok(await initializeDatabase(adopted, syncedPath, names));
    assert.equal(
      (await adopted.query('SELECT body FROM mas_content_asset'))[0].body,
      'Synchronized profile',
    );
    console.log(
      'PASS: previously synchronized profiles without migration history are adopted without dropping data.',
    );

    class FailingMigration1789041600000 implements MigrationInterface {
      name = 'FailingMigration1789041600000';
      async up(runner: QueryRunner) {
        await runner.query('CREATE TABLE should_rollback (id integer)');
        throw new Error('Simulated failed upgrade');
      }
      async down() {}
    }
    await upgraded.destroy();
    const failing = open(
      new DataSource({
        type: 'better-sqlite3',
        database: oldPath,
        entities: databaseEntities,
        migrations: [...migrationTypes, FailingMigration1789041600000],
        synchronize: false,
        migrationsRun: false,
      }),
    );
    await assert.rejects(
      initializeDatabase(failing, oldPath, [
        ...names,
        'FailingMigration1789041600000',
      ]),
      /pre-upgrade backup/,
    );
    assert.equal(failing.isInitialized, false);
    const check = open(source(oldPath));
    await check.initialize();
    assert.equal(
      (
        await check.query(
          "SELECT name FROM sqlite_master WHERE name='should_rollback'",
        )
      ).length,
      0,
    );
    assert.equal(
      (await check.query('SELECT body FROM mas_content_asset'))[0].body,
      'Keep this draft',
    );
    await check.query(
      "INSERT INTO migrations (timestamp,name) VALUES (9999999999999,'FutureMigration9999999999999')",
    );
    await check.destroy();
    await assert.rejects(
      backupBeforeUpgrade(oldPath, names),
      /newer USCut version/,
    );
    console.log(
      'PASS: failed migrations roll back and keep backups; older apps reject unknown future migration histories.',
    );
  } finally {
    for (const connection of connections)
      if (connection.isInitialized) await connection.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
