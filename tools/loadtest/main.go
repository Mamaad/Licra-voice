package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/coder/websocket"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type message struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

var events, errors, sessions atomic.Int64
var mu sync.Mutex
var latencies []float64

func send(ctx context.Context, c *websocket.Conn, kind, id string, p any) error {
	payload, _ := json.Marshal(p)
	b, _ := json.Marshal(message{Type: kind, RequestID: id, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Payload: payload})
	return c.Write(ctx, websocket.MessageText, b)
}
func simulate(ctx context.Context, address string, index int) {
	hs, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	c, _, e := websocket.Dial(hs, address, nil)
	if e != nil {
		errors.Add(1)
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(8 << 20)
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	e = send(hs, c, "CLIENT_HELLO", "hello", map[string]any{"protocol_version": 1, "client_version": "0.1.0", "nickname": fmt.Sprintf("load-%d", index), "device_public_key": base64.StdEncoding.EncodeToString(pub)})
	if e != nil {
		errors.Add(1)
		return
	}
	_, b, e := c.Read(hs)
	var hello message
	if e != nil || json.Unmarshal(b, &hello) != nil || hello.Type != "SERVER_HELLO" {
		errors.Add(1)
		return
	}
	var p struct {
		Context string `json:"challenge_context"`
	}
	if json.Unmarshal(hello.Payload, &p) != nil {
		errors.Add(1)
		return
	}
	if send(hs, c, "AUTHENTICATE", "auth", map[string]string{"signature": base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(p.Context)))}) != nil {
		errors.Add(1)
		return
	}
	pending := map[string]time.Time{}
	var lock sync.Mutex
	ready := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-ready:
		}
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				lock.Lock()
				id := strconv.FormatInt(time.Now().UnixNano(), 10)
				pending[id] = time.Now()
				e := send(ctx, c, "PING", id, nil)
				lock.Unlock()
				if e != nil {
					return
				}
			}
		}
	}()
	for {
		_, b, e = c.Read(ctx)
		if e != nil {
			return
		}
		var m message
		if json.Unmarshal(b, &m) != nil {
			errors.Add(1)
			return
		}
		events.Add(1)
		lock.Lock()
		if m.Type == "SNAPSHOT" {
			sessions.Add(1)
			close(ready)
		}
		if m.Type == "PING" {
			send(ctx, c, "PONG", "hb", nil)
		}
		if m.Type == "PONG" {
			if start, ok := pending[m.RequestID]; ok {
				mu.Lock()
				latencies = append(latencies, float64(time.Since(start).Microseconds())/1000)
				mu.Unlock()
				delete(pending, m.RequestID)
			}
		}
		if m.Type == "ERROR" {
			errors.Add(1)
		}
		lock.Unlock()
	}
}
func process(pid int) (ticks, rss uint64) {
	if pid == 0 {
		return
	}
	b, e := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if e != nil {
		return
	}
	i := strings.LastIndex(string(b), ")")
	if i < 0 {
		return
	}
	f := strings.Fields(string(b[i+1:]))
	if len(f) < 22 {
		return
	}
	a, _ := strconv.ParseUint(f[11], 10, 64)
	c, _ := strconv.ParseUint(f[12], 10, 64)
	pages, _ := strconv.ParseUint(f[21], 10, 64)
	return a + c, pages * uint64(os.Getpagesize())
}
func main() {
	address := flag.String("url", "ws://127.0.0.1:64738/ws", "control websocket")
	clients := flag.Int("clients", 50, "simulated identities")
	duration := flag.Duration("duration", 30*time.Second, "measurement duration")
	pid := flag.Int("server-pid", 0, "optional local PID for CPU/RAM")
	flag.Parse()
	if *clients < 1 || *clients > 10000 || *duration < time.Second {
		fmt.Fprintln(os.Stderr, "invalid limits")
		os.Exit(1)
	}
	ticks0, _ := process(*pid)
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), *duration)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < *clients; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); simulate(ctx, *address, i) }(i)
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	ticks1, rss := process(*pid)
	cpu := 0.
	if *pid > 0 {
		hz := 100.
		if b, e := exec.Command("getconf", "CLK_TCK").Output(); e == nil {
			if n, e := strconv.ParseFloat(strings.TrimSpace(string(b)), 64); e == nil {
				hz = n
			}
		}
		cpu = float64(ticks1-ticks0) / hz / elapsed * 100
	}
	sort.Float64s(latencies)
	percentile := func(p float64) float64 {
		if len(latencies) == 0 {
			return 0
		}
		return latencies[int(float64(len(latencies)-1)*p)]
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"clients_requested": *clients, "sessions_connected": sessions.Load(), "errors": errors.Load(), "elapsed_seconds": elapsed, "events_per_second": float64(events.Load()) / elapsed, "latency_p50_ms": percentile(.5), "latency_p95_ms": percentile(.95), "server_cpu_percent_one_core": cpu, "server_rss_bytes": rss, "cpu_ram_measured": *pid > 0, "audio": false})
	if errors.Load() > 0 {
		os.Exit(1)
	}
}
