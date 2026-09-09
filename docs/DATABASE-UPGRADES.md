# Database upgrades

Production startup now disables TypeORM schema synchronization and automatic migration execution. It checks existing SQLite integrity and migration history, creates a verified online backup when migrations are pending, and then runs migrations explicitly in a transaction. Unknown migration histories (including a database opened by a newer app) are rejected before upgrade. Failures stop social-backend startup and display an error instead of silently proceeding.

Backups live beside `database.sqlite` in `database-backups/before-upgrade-*.sqlite`. They are full SQLite snapshots, including committed WAL writes, and are checked before upgrade proceeds. Backups are not automatically removed. They can contain private account and customer data and should remain local. They do not replace project/media or encrypted-credential backups. Restoring still requires closing USCut and a controlled restore procedure; an in-app restore workflow remains to be implemented.

The frozen `1788955200-schema.json` and `ProductionBaseline1788955200000` migration adopt the September 2026 schema previously supplied by synchronization: nine missing tables and thirteen missing columns versus the historical migrations. The migration adds missing tables/columns/indexes, preserves existing rows and legacy columns/constraints, and does not dynamically follow future entity changes. Future schema changes require new migrations. Historical initial table/status migrations now tolerate preexisting synchronized tables and columns, allowing adoption of profiles without migration history.

Run `node scripts/test-database-upgrades.mjs` under the repository's installed Electron ABI. It verifies clean startup and repeat launch, old-schema data preservation, online backup with WAL writes, synchronized-profile adoption, failed-migration rollback with retained backup, and rejection of unknown future migrations. All test databases are temporary fixtures. Dale's live database is not opened by this harness.

References: [SQLite online backup](https://www.sqlite.org/backup.html), [TypeORM migrations](https://typeorm.io/docs/advanced-topics/migrations/).
