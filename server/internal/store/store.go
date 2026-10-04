package store

import (
	"database/sql"
	"fmt"
	"licra/server/migrations"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sort"
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
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	fail := func(err error) (*sql.DB, error) { db.Close(); return nil, err }
	for _, q := range []string{"PRAGMA foreign_keys=ON", "PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=5000", "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)"} {
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
		var n int
		if err = db.QueryRow("SELECT count(*) FROM schema_migrations WHERE version=?", name).Scan(&n); err != nil {
			return fail(err)
		}
		if n > 0 {
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
