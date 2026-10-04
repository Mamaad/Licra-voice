package main

import (
	"context"
	"flag"
	"fmt"
	"licra/server/internal/config"
	"licra/server/internal/control"
	"licra/server/internal/media"
	"licra/server/internal/protocol"
	"licra/server/internal/store"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func run() error {
	p := flag.String("config", config.DefaultPath(), "configuration path")
	basePort := flag.Int("base-port", 0, "initial or overridden base port")
	version := flag.Bool("version", false, "print version")
	flag.Parse()
	if *version {
		fmt.Println(protocol.ServerVersion)
		return nil
	}
	c, e := config.Load(*p)
	if e != nil {
		return e
	}
	if *basePort != 0 {
		if *basePort < 1024 || *basePort > 65533 {
			return fmt.Errorf("invalid base port")
		}
		c.Server.BasePort = *basePort
		c.LiveKit.MediaUDPPort = *basePort + 1
		c.LiveKit.MediaTCPPort = *basePort + 2
		if e = config.Save(*p, c); e != nil {
			return e
		}
	}
	if flag.NArg() > 0 && flag.Arg(0) == "ports" {
		fmt.Printf("%d\n%d\n%d\n", c.Server.BasePort, c.LiveKit.MediaUDPPort, c.LiveKit.MediaTCPPort)
		return nil
	}
	if flag.NArg() > 0 && flag.Arg(0) == "media-health" {
		lk := media.Service{URL: fmt.Sprintf("http://127.0.0.1:%d", c.LiveKit.InternalPort), Key: c.LiveKit.APIKey, Secret: c.LiveKit.APISecret}
		return lk.Ensure(context.Background(), "healthcheck")
	}
	if e = config.WriteLiveKit(filepath.Join(filepath.Dir(*p), "livekit.yaml"), c); e != nil {
		return e
	}
	if flag.NArg() > 0 && flag.Arg(0) == "init-config" {
		return nil
	}
	level := slog.LevelInfo
	switch c.Logging.Level {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})))
	if flag.NArg() > 0 {
		switch flag.Arg(0) {
		case "init-config", "ports", "media-health", "doctor", "admin-token":
		default:
			return fmt.Errorf("unknown command")
		}
	}
	db, e := store.Open(c.Database.Path)
	if e != nil {
		return e
	}
	defer db.Close()
	app, e := control.New(c, db)
	if e != nil {
		return e
	}
	defer app.Close()
	if flag.NArg() > 0 && flag.Arg(0) == "doctor" {
		var status string
		if e = db.QueryRow("PRAGMA quick_check").Scan(&status); e != nil {
			return e
		}
		if status != "ok" {
			return fmt.Errorf("SQLite: %s", status)
		}
		fmt.Println("Configuration, migrations et SQLite OK")
		return nil
	}
	if flag.NArg() > 0 && flag.Arg(0) == "admin-token" {
		regenerate := flag.NArg() > 1 && flag.Arg(1) == "--regenerate"
		token, e := app.AdminToken(regenerate)
		if e != nil {
			return e
		}
		fmt.Println(token)
		return nil
	}
	if app.BootstrapNeeded() {
		token, e := app.AdminToken(false)
		if e != nil {
			return e
		}
		fmt.Fprintln(os.Stderr, "Initial administrator token (shown once): "+token)
	}
	s := http.Server{Addr: fmt.Sprintf("%s:%d", c.Server.Bind, c.Server.BasePort), Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		app.Close()
		end, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.Shutdown(end)
	}()
	slog.Info("listening", "address", s.Addr)
	if c.Server.TLSCert != "" {
		e = s.ListenAndServeTLS(c.Server.TLSCert, c.Server.TLSKey)
	} else {
		e = s.ListenAndServe()
	}
	if e == http.ErrServerClosed {
		return nil
	}
	return e
}
func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	if e := run(); e != nil {
		slog.Error("fatal", "error", e)
		os.Exit(1)
	}
}
