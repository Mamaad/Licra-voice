package store

import (
	"database/sql"
	"fmt"
	"licra/server/migrations"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sort"
	"syscall"
)

func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	// Linux file lock serializes first-time WAL setup and migrations across processes.
	lock, err := os.OpenFile(path+".migration.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return nil, err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	fail := func(err error) (*sql.DB, error) { db.Close(); return nil, err }
	for _, q := range []string{"PRAGMA busy_timeout=5000", "PRAGMA foreign_keys=ON", "PRAGMA journal_mode=WAL", "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)"} {
		if _, err = db.Exec(q); err != nil {
			return fail(err)
		}
	}
	entries, err := migrations.Files.ReadDir(".")
	if err != nil {
		return fail(err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		name := entry.Name()
		if filepath.Ext(name) != ".sql" {
			continue
		}
		data, e := migrations.Files.ReadFile(name)
		if e != nil {
			return fail(e)
		}
		tx, e := db.Begin()
		if e != nil {
			return fail(e)
		}
		var n int
		if e = tx.QueryRow("SELECT count(*) FROM schema_migrations WHERE version=?", name).Scan(&n); e != nil {
			tx.Rollback()
			return fail(e)
		}
		if n > 0 {
			tx.Rollback()
			continue
		}
		if _, e = tx.Exec(string(data)); e == nil {
			_, e = tx.Exec("INSERT INTO schema_migrations VALUES (?)", name)
		}
		if e != nil {
			tx.Rollback()
			return fail(fmt.Errorf("migration %s: %w", name, e))
		}
		if e = tx.Commit(); e != nil {
			return fail(e)
		}
	}
	return db, nil
}
