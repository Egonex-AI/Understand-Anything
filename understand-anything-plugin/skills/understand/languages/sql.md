# SQL Language Prompt Snippet

## Key Concepts

- **DDL (Data Definition)**: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` for schema management
- **DML (Data Manipulation)**: `SELECT`, `INSERT`, `UPDATE`, `DELETE` for data operations
- **Normalization**: Organizing tables to reduce redundancy through 1NF, 2NF, 3NF relationships
- **Foreign Keys**: `REFERENCES` constraints enforcing referential integrity between tables
- **Indexes**: `CREATE INDEX` for query performance optimization on frequently queried columns
- **Migrations**: Numbered, sequential schema changes applied in order for version control
- **Transactions**: `BEGIN`/`COMMIT`/`ROLLBACK` for atomic multi-statement operations
- **Views**: Named queries (`CREATE VIEW`) providing virtual tables for complex joins
- **Stored Procedures**: Server-side functions for encapsulating business logic in the database
- **Constraints**: `NOT NULL`, `UNIQUE`, `CHECK`, `DEFAULT` for data integrity rules

## Notable File Patterns

- `migrations/*.sql` — Numbered migration files (e.g., `001_create_users.sql`, `002_add_orders.sql`)
- `schema.sql` — Full database schema definition (often generated from migrations)
- `seeds/*.sql` — Seed data for development and testing environments
- `*.up.sql` / `*.down.sql` — Reversible migration pairs (up applies, down reverts)
- `init.sql` — Database initialization script for Docker or fresh setup
- `procedures/*.sql` — Stored procedure definitions

## Edge Patterns

- SQL migration files `migrates` the tables they create or alter
- Schema definition files `defines_schema` for the ORM models or data layer code that reads them
- Table definitions create implicit `related` edges between tables connected by foreign keys
- Seed files `depends_on` the migration files that create the tables they populate

## Summary Style

> "Database migration creating the users table with email, name, and authentication columns."
> "Schema definition with N tables covering user management, orders, and payment processing."
> "Seed data populating N tables with development fixtures for testing."
