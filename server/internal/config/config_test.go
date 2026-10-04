package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.toml")
	c, e := Load(p)
	if e != nil || c.LiveKit.MediaUDPPort != 64739 {
		t.Fatal(c, e)
	}
	os.WriteFile(p, []byte("[server]\nbase_port=80\n"), 0600)
	if _, e = Load(p); e == nil {
		t.Fatal("privileged port accepted")
	}
}
