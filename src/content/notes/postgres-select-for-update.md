---
title: "SELECT ... FOR UPDATE in PostgreSQL: an atomic read-modify-write"
description: "Why reading a row and then updating it loses writes under concurrency, how SELECT ... FOR UPDATE fixes it, the four row lock modes, NOWAIT and SKIP LOCKED, and the gotchas I ran into."
pubDatetime: 2026-10-27T12:00:00Z
tags:
  - postgresql
  - sql
  - concurrency
  - efcore
draft: false
---

I had code that read an account balance, checked it in C#, and wrote the new balance back. It passed every test. Then two requests for the same account arrived at the same moment, and one withdrawal simply disappeared. Nothing failed, no exception, just a wrong number. The fix was two words at the end of the `SELECT`: `FOR UPDATE`.

## The problem: lost updates

The pattern looks harmless:

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1;   -- returns 100
-- application: 100 - 30 = 70, enough money, OK
UPDATE accounts SET balance = 70 WHERE id = 1;
COMMIT;
```

Now run it twice at the same time, withdrawing 30 and 50:

| Time | Transaction A (withdraw 30) | Transaction B (withdraw 50) |
| --- | --- | --- |
| 1 | `SELECT balance` → 100 | |
| 2 | | `SELECT balance` → 100 |
| 3 | `UPDATE ... SET balance = 70` | |
| 4 | `COMMIT` | |
| 5 | | `UPDATE ... SET balance = 50` |
| 6 | | `COMMIT` |

Final balance: 50. It should be 20. A's write was overwritten by B, which decided based on a value that was already stale. This is a **lost update**, and the default isolation level in PostgreSQL (`READ COMMITTED`) does nothing to prevent it. A plain `SELECT` takes no locks, so both transactions happily read the same row.

The transaction is not the problem. It makes the writes atomic, but the *read* and the *write* are still two separate steps, and someone else can slip in between them.

## The fix: lock the row when you read it

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;  -- [!code highlight]
-- application: check and compute
UPDATE accounts SET balance = 70 WHERE id = 1;
COMMIT;
```

`FOR UPDATE` takes a row-level lock on every row the `SELECT` returns. The lock is held **until the transaction ends** (commit or rollback). Any other transaction that tries to lock, update or delete the same row waits until then.

Replaying the timeline:

| Time | Transaction A (withdraw 30) | Transaction B (withdraw 50) |
| --- | --- | --- |
| 1 | `SELECT ... FOR UPDATE` → 100, row locked | |
| 2 | | `SELECT ... FOR UPDATE` → **waits** |
| 3 | `UPDATE ... SET balance = 70` | (still waiting) |
| 4 | `COMMIT`, lock released | |
| 5 | | returns **70**, row locked |
| 6 | | `UPDATE ... SET balance = 20`, `COMMIT` |

B now sees 70, not 100. The read-check-write sequence has become atomic with respect to every other transaction that also uses `FOR UPDATE` on that row.

A detail worth knowing: in `READ COMMITTED`, when B wakes up, PostgreSQL re-reads the **latest committed version** of the row and re-checks the `WHERE` clause against it. If A had changed the row so that it no longer matched (or deleted it), B would simply get zero rows back.

### What it does *not* block

Plain `SELECT` statements without a locking clause are never blocked. PostgreSQL uses MVCC, so readers see a snapshot and don't wait for writers. That's great for performance, but it also means **every code path that does read-modify-write on that row must use `FOR UPDATE`**. One forgotten plain `SELECT` brings the lost update back.

## Try it yourself

Open two `psql` sessions against the same database:

```sql
CREATE TABLE accounts (id int PRIMARY KEY, balance numeric NOT NULL);
INSERT INTO accounts VALUES (1, 100);
```

**Session 1:**

```sql
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
```

**Session 2:**

```sql
BEGIN;
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;  -- hangs
```

Session 2 sits there. Run `UPDATE accounts SET balance = 70 WHERE id = 1; COMMIT;` in session 1, and session 2 immediately returns the row with `balance = 70`. While it hangs, you can see who is waiting on whom from a third session:

```sql
SELECT pid, wait_event_type, state, query, pg_blocking_pids(pid) AS blocked_by
FROM pg_stat_activity
WHERE datname = current_database();
```

## Often you don't need it at all

If the whole decision fits in SQL, a single `UPDATE` is already atomic and takes the row lock itself:

```sql
UPDATE accounts
SET balance = balance - 30
WHERE id = 1 AND balance >= 30
RETURNING balance;
```

Zero rows returned means "not enough money". No explicit transaction and no round trip in between. I reach for `FOR UPDATE` only when the logic between read and write has to happen in application code: calling another service, complex validation, or updating several tables based on what I read.

## The four row lock modes

`FOR UPDATE` is the strongest of four locking clauses:

| Clause | Use it when | Conflicts with |
| --- | --- | --- |
| `FOR UPDATE` | You will delete the row or change its key columns | all four |
| `FOR NO KEY UPDATE` | You will update the row, but not its primary/unique key | `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` |
| `FOR SHARE` | The row must not change while you work, but you won't change it either | `FOR UPDATE`, `FOR NO KEY UPDATE` |
| `FOR KEY SHARE` | Only the key must not change (what foreign key checks use) | `FOR UPDATE` |

The practical takeaway: a normal `UPDATE` that doesn't touch the key takes `FOR NO KEY UPDATE`, not `FOR UPDATE`. Inserting a child row with a foreign key to the locked row takes `FOR KEY SHARE` on the parent. So if you lock a parent with `FOR UPDATE`, inserts into its child tables block until you commit. If you only intend to update non-key columns, `FOR NO KEY UPDATE` gives the same protection against lost updates without that side effect.

## Don't want to wait? NOWAIT and SKIP LOCKED

By default a blocked transaction waits forever. Two options change that.

**`NOWAIT`** fails immediately instead of waiting:

```sql
SELECT * FROM accounts WHERE id = 1 FOR UPDATE NOWAIT;
-- ERROR: could not obtain lock on row in relation "accounts"  (SQLSTATE 55P03)
```

Useful when "someone else is editing this, try again later" is a better answer than a hanging request. A softer version is a timeout for the transaction: `SET LOCAL lock_timeout = '2s';`.

**`SKIP LOCKED`** silently skips rows that are already locked. That sounds odd for an account balance, but it's exactly what you want for a **job queue**: several workers each grab a different pending job without stepping on each other.

```sql
WITH next_job AS (
  SELECT id
  FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED  -- [!code highlight]
)
UPDATE jobs
SET status = 'running', started_at = now()
FROM next_job
WHERE jobs.id = next_job.id
RETURNING jobs.*;
```

Run this from ten workers at once and each one gets a different job, with no waiting and no double processing. This one query is the core of most "Postgres as a queue" libraries.

## Using it from EF Core

EF Core has no `.ForUpdate()` operator, but `FromSql` works, as long as it runs inside a transaction:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();

var account = await db.Accounts
    .FromSql($"SELECT * FROM accounts WHERE id = {id} FOR UPDATE")
    .SingleAsync();

if (account.Balance < amount)
    throw new InsufficientFundsException();

account.Balance -= amount;
await db.SaveChangesAsync();

await tx.CommitAsync();
```

The `{id}` in the interpolated string becomes a parameter, not string concatenation, so this is safe from SQL injection.

## Gotchas

- **No transaction, no lock.** Outside `BEGIN ... COMMIT`, every statement is its own transaction, so the lock is released the moment the `SELECT` finishes. This is the most common mistake, especially with ORMs and connection pools that run in autocommit mode. The query succeeds and protects nothing.
- **Locks last until the end of the transaction.** Don't call a slow HTTP API or wait for user input while holding a row lock. Every other writer of that row queues up behind you.
- **Lock rows in a consistent order.** If A locks row 1 then row 2, and B locks row 2 then row 1, they deadlock. PostgreSQL detects it after `deadlock_timeout` (1 second by default) and aborts one of them with `deadlock detected` (SQLSTATE `40P01`). When locking several rows, lock them in one statement with a stable order: `... WHERE id IN (1, 2) ORDER BY id FOR UPDATE`.
- **Joins lock every table.** `SELECT ... FROM orders JOIN customers ... FOR UPDATE` locks the matching rows in *both* tables. Use `FOR UPDATE OF orders` to lock only what you mean to change. It's also required with a `LEFT JOIN`, because the nullable side can't be locked.
- **Not allowed with aggregates.** `FOR UPDATE` can't be combined with `GROUP BY`, `DISTINCT`, aggregate functions, window functions or `UNION`, because the result rows don't map back to single table rows. Lock the rows in a subquery or CTE first.
- **It locks rows, not gaps.** `FOR UPDATE` only locks rows that exist. It doesn't stop another transaction from inserting a new row that would have matched your `WHERE`. For "check that no such row exists, then insert", use a unique constraint (`INSERT ... ON CONFLICT`) or the `SERIALIZABLE` isolation level.
- **Higher isolation levels behave differently.** Under `REPEATABLE READ` or `SERIALIZABLE`, if the row was changed by a transaction that committed after yours started, `FOR UPDATE` doesn't wait and re-read. It fails with `could not serialize access due to concurrent update` (SQLSTATE `40001`), and your code has to retry the whole transaction.

## References

- [PostgreSQL docs: The Locking Clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [PostgreSQL docs: Row-Level Locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
- [PostgreSQL docs: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
