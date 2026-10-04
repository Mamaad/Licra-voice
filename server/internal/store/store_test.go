package store

import (
	"path/filepath"
	"sync"
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
		if n != 3 {
			t.Fatal(n)
		}
		d.Close()
	}
}

func TestConcurrentFirstOpen(t *testing.T) {
	p := filepath.Join(t.TempDir(), "concurrent db")
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			d, e := Open(p)
			if e != nil {
				t.Error(e)
				return
			}
			defer d.Close()
			var n int
			if e = d.QueryRow("SELECT count(*) FROM schema_migrations").Scan(&n); e != nil || n != 3 {
				t.Errorf("migrations=%d, error=%v", n, e)
			}
		}()
	}
	close(start)
	wg.Wait()
}
