package store

import (
	"path/filepath"
	"testing"
)

func TestMigrations(t *testing.T) {
	p := filepath.Join(t.TempDir(), "db")
	for i := 0; i < 2; i++ {
		d, e := Open(p)
		if e != nil {
			t.Fatal(e)
		}
		var n int
		d.QueryRow("select count(*) from schema_migrations").Scan(&n)
		if n != 1 {
			t.Fatal(n)
		}
		d.Close()
	}
}
