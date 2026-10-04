package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"github.com/pelletier/go-toml/v2"
	"licra/server/internal/protocol"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Server struct {
		Name                 string `toml:"name"`
		Bind                 string `toml:"bind"`
		BasePort             int    `toml:"base_port"`
		MaxClients           int    `toml:"max_clients"`
		MinimumClientVersion string `toml:"minimum_client_version"`
		TLSCert              string `toml:"tls_cert"`
		TLSKey               string `toml:"tls_key"`
	} `toml:"server"`
	Database struct {
		Path string `toml:"path"`
	} `toml:"database"`
	Voice struct {
		DefaultProfile string `toml:"default_profile"`
	} `toml:"voice"`
	LiveKit struct {
		Binary       string `toml:"binary"`
		InternalPort int    `toml:"internal_port"`
		MediaUDPPort int    `toml:"media_udp_port"`
		MediaTCPPort int    `toml:"media_tcp_port"`
		APIKey       string `toml:"api_key"`
		APISecret    string `toml:"api_secret"`
		PublicIP     string `toml:"public_ip"`
	} `toml:"livekit"`
	Security struct {
		AllowPlainIPConnection bool `toml:"allow_plain_ip_connection"`
		HandshakeRateLimit     int  `toml:"handshake_rate_limit"`
		MaxChannels            int  `toml:"max_channels"`
	} `toml:"security"`
	Turn struct {
		Enabled  bool   `toml:"enabled"`
		Domain   string `toml:"domain"`
		UDPPort  int    `toml:"udp_port"`
		TLSPort  int    `toml:"tls_port"`
		CertFile string `toml:"cert_file"`
		KeyFile  string `toml:"key_file"`
	} `toml:"turn"`
	Logging struct {
		Level string `toml:"level"`
	} `toml:"logging"`
}

func Expand(p string) string {
	if strings.HasPrefix(p, "~/") {
		h, _ := os.UserHomeDir()
		return filepath.Join(h, p[2:])
	}
	return p
}
func DefaultPath() string {
	p := os.Getenv("XDG_CONFIG_HOME")
	if p == "" {
		p = Expand("~/.config")
	}
	return filepath.Join(p, "licra/config.toml")
}
func Defaults() Config {
	var c Config
	c.Server.Name = "Licra"
	c.Server.Bind = "0.0.0.0"
	c.Server.BasePort = 64738
	c.Server.MaxClients = 100
	c.Server.MinimumClientVersion = "0.1.0"
	c.Database.Path = Expand("~/.local/share/licra/licra.db")
	c.Voice.DefaultProfile = "standard"
	c.LiveKit.Binary = Expand("~/.local/bin/livekit-server")
	c.LiveKit.InternalPort = 7880
	c.Security.AllowPlainIPConnection = true
	c.Security.HandshakeRateLimit = 10
	c.Security.MaxChannels = 1000
	c.Logging.Level = "info"
	c.Turn.UDPPort = 3478
	c.Turn.TLSPort = 5349
	return c
}
func Load(path string) (Config, error) {
	c := Defaults()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return c, err
		}
		data, err = toml.Marshal(c)
		if err == nil {
			err = os.WriteFile(path, data, 0600)
		}
	}
	if err != nil {
		return c, err
	}
	if err = toml.Unmarshal(data, &c); err != nil {
		return c, err
	}
	c.Database.Path = Expand(c.Database.Path)
	c.LiveKit.Binary = Expand(c.LiveKit.Binary)
	if c.LiveKit.MediaUDPPort == 0 {
		c.LiveKit.MediaUDPPort = c.Server.BasePort + 1
	}
	if c.LiveKit.MediaTCPPort == 0 {
		c.LiveKit.MediaTCPPort = c.Server.BasePort + 2
	}
	if c.Server.BasePort < 1024 || c.Server.BasePort > 65533 || c.LiveKit.MediaUDPPort < 1024 || c.LiveKit.MediaUDPPort > 65535 || c.LiveKit.MediaTCPPort < 1024 || c.LiveKit.MediaTCPPort > 65535 || c.LiveKit.InternalPort < 1024 || c.LiveKit.InternalPort > 65535 {
		return c, fmt.Errorf("ports must be between 1024 and 65535 (base <=65533)")
	}
	if c.Server.BasePort == c.LiveKit.InternalPort || c.LiveKit.MediaTCPPort == c.Server.BasePort || c.LiveKit.MediaTCPPort == c.LiveKit.InternalPort {
		return c, fmt.Errorf("TCP ports must be distinct")
	}
	if net.ParseIP(c.Server.Bind) == nil || c.Server.MaxClients < 1 || c.Server.MaxClients > 10000 || c.Security.HandshakeRateLimit < 1 || c.Security.MaxChannels < 1 || c.Security.MaxChannels > 10000 || c.Server.Name == "" || len(c.Server.Name) > 128 {
		return c, fmt.Errorf("invalid server limits, name or bind IP")
	}
	if (c.Server.TLSCert == "") != (c.Server.TLSKey == "") || (!c.Security.AllowPlainIPConnection && c.Server.TLSCert == "") {
		return c, fmt.Errorf("TLS certificate and key required")
	}
	if c.Voice.DefaultProfile != "eco" && c.Voice.DefaultProfile != "standard" && c.Voice.DefaultProfile != "high" {
		return c, fmt.Errorf("invalid audio profile")
	}
	if _, e := protocol.Semver(c.Server.MinimumClientVersion); e != nil {
		return c, e
	}
	switch c.Logging.Level {
	case "debug", "info", "warn", "error":
	default:
		return c, fmt.Errorf("invalid log level")
	}
	if c.LiveKit.PublicIP != "" && net.ParseIP(c.LiveKit.PublicIP) == nil {
		return c, fmt.Errorf("invalid public IP")
	}
	if c.Turn.Enabled && (c.Turn.Domain == "" || c.Turn.CertFile == "" || c.Turn.KeyFile == "" || c.Turn.UDPPort < 1024 || c.Turn.UDPPort > 65535 || c.Turn.TLSPort < 1024 || c.Turn.TLSPort > 65535 || c.Turn.TLSPort == c.Server.BasePort || c.Turn.TLSPort == c.LiveKit.InternalPort || c.Turn.TLSPort == c.LiveKit.MediaTCPPort || c.Turn.UDPPort == c.LiveKit.MediaUDPPort) {
		return c, fmt.Errorf("invalid optional TURN configuration")
	}
	if c.LiveKit.APIKey == "" || c.LiveKit.APISecret == "" {
		b := make([]byte, 32)
		rand.Read(b)
		c.LiveKit.APIKey = "licra"
		c.LiveKit.APISecret = hex.EncodeToString(b)
		if err = Save(path, c); err != nil {
			return c, err
		}
	}
	if len(c.LiveKit.APISecret) < 32 {
		return c, fmt.Errorf("LiveKit secret must have >=32 characters")
	}
	return c, nil
}
func Save(path string, c Config) error {
	data, e := toml.Marshal(c)
	if e != nil {
		return e
	}
	return os.WriteFile(path, data, 0600)
}
func WriteLiveKit(path string, c Config) error {
	external := "use_external_ip: true"
	if c.LiveKit.PublicIP != "" {
		if net.ParseIP(c.LiveKit.PublicIP) == nil {
			return fmt.Errorf("invalid livekit public IP")
		}
		external = "use_external_ip: false\n  node_ip: " + c.LiveKit.PublicIP
	}
	data := fmt.Sprintf("port: %d\nbind_addresses: [127.0.0.1]\nrtc:\n  udp_port: %d\n  tcp_port: %d\n  %s\nkeys:\n  %s: %s\nlogging:\n  level: info\n# Optional TURN requires separate public ports and certificates; see docs/server-install.md.\n", c.LiveKit.InternalPort, c.LiveKit.MediaUDPPort, c.LiveKit.MediaTCPPort, external, strconv.Quote(c.LiveKit.APIKey), strconv.Quote(c.LiveKit.APISecret))
	if c.Turn.Enabled {
		data += fmt.Sprintf("turn:\n  enabled: true\n  domain: %s\n  udp_port: %d\n  tls_port: %d\n  cert_file: %s\n  key_file: %s\n", strconv.Quote(c.Turn.Domain), c.Turn.UDPPort, c.Turn.TLSPort, strconv.Quote(Expand(c.Turn.CertFile)), strconv.Quote(Expand(c.Turn.KeyFile)))
	}
	return os.WriteFile(path, []byte(data), 0600)
}
