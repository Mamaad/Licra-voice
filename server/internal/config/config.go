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

type ChatConfig struct {
	MaxStoredMessages   int  `toml:"max_stored_messages" json:"max_stored_messages"`
	MaxThreads          int  `toml:"max_threads" json:"max_threads"`
	Enabled             bool `toml:"enabled" json:"enabled"`
	HistoryEnabled      bool `toml:"history_enabled" json:"history_enabled"`
	MaxMessageLength    int  `toml:"max_message_length" json:"max_message_length"`
	MessagesPerSecond   int  `toml:"messages_per_second" json:"messages_per_second"`
	MessagesPerMinute   int  `toml:"messages_per_minute" json:"messages_per_minute"`
	EditsPerMinute      int  `toml:"edits_per_minute" json:"edits_per_minute"`
	TypingPerSecond     int  `toml:"typing_per_second" json:"typing_per_second"`
	ChannelHistoryLimit int  `toml:"channel_history_limit" json:"channel_history_limit"`
	PrivateHistoryLimit int  `toml:"private_history_limit" json:"private_history_limit"`
	RetentionDays       int  `toml:"retention_days" json:"retention_days"`
}
type ScreenConfig struct {
	Enabled             bool `toml:"enabled" json:"enabled"`
	MaxSharesPerChannel int  `toml:"max_shares_per_channel" json:"max_shares_per_channel"`
	MaxBitrate          int  `toml:"max_bitrate" json:"max_bitrate"`
	MaxHeight           int  `toml:"max_height" json:"max_height"`
	MaxFPS              int  `toml:"max_fps" json:"max_fps"`
}
type YouTubeConfig struct {
	Enabled           bool `toml:"enabled" json:"enabled"`
	MaxQueue          int  `toml:"max_queue" json:"max_queue"`
	CommandsPerMinute int  `toml:"commands_per_minute" json:"commands_per_minute"`
	ChangesPerMinute  int  `toml:"changes_per_minute" json:"changes_per_minute"`
}
type Config struct {
	YouTube YouTubeConfig `toml:"youtube" json:"youtube"`
	Chat    ChatConfig    `toml:"chat" json:"chat"`
	Screen  ScreenConfig  `toml:"screen_share" json:"screen_share"`
	Server  struct {
		Name                 string `toml:"name" json:"name"`
		Bind                 string `toml:"bind" json:"bind"`
		BasePort             int    `toml:"base_port" json:"base_port"`
		MaxClients           int    `toml:"max_clients" json:"max_clients"`
		MinimumClientVersion string `toml:"minimum_client_version" json:"minimum_client_version"`
		TLSCert              string `toml:"tls_cert" json:"tls_cert"`
		TLSKey               string `toml:"tls_key" json:"tls_key"`
	} `toml:"server" json:"server"`
	Database struct {
		Path string `toml:"path" json:"path"`
	} `toml:"database" json:"database"`
	Voice struct {
		DefaultProfile string `toml:"default_profile" json:"default_profile"`
	} `toml:"voice" json:"voice"`
	LiveKit struct {
		Binary       string `toml:"binary" json:"binary"`
		InternalPort int    `toml:"internal_port" json:"internal_port"`
		MediaUDPPort int    `toml:"media_udp_port" json:"media_udp_port"`
		MediaTCPPort int    `toml:"media_tcp_port" json:"media_tcp_port"`
		APIKey       string `toml:"api_key" json:"api_key"`
		APISecret    string `toml:"api_secret" json:"api_secret"`
		PublicIP     string `toml:"public_ip" json:"public_ip"`
	} `toml:"livekit" json:"livekit"`
	Security struct {
		AllowPlainIPConnection bool `toml:"allow_plain_ip_connection" json:"allow_plain_ip_connection"`
		HandshakeRateLimit     int  `toml:"handshake_rate_limit" json:"handshake_rate_limit"`
		MaxChannels            int  `toml:"max_channels" json:"max_channels"`
	} `toml:"security" json:"security"`
	Turn struct {
		Enabled  bool   `toml:"enabled" json:"enabled"`
		Domain   string `toml:"domain" json:"domain"`
		UDPPort  int    `toml:"udp_port" json:"udp_port"`
		TLSPort  int    `toml:"tls_port" json:"tls_port"`
		CertFile string `toml:"cert_file" json:"cert_file"`
		KeyFile  string `toml:"key_file" json:"key_file"`
	} `toml:"turn" json:"turn"`
	Logging struct {
		Level string `toml:"level" json:"level"`
	} `toml:"logging" json:"logging"`
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
	c.YouTube = YouTubeConfig{Enabled: true, MaxQueue: 100, CommandsPerMinute: 120, ChangesPerMinute: 10}
	c.Chat = ChatConfig{MaxStoredMessages: 100000, MaxThreads: 10000, Enabled: true, HistoryEnabled: true, MaxMessageLength: 4000, MessagesPerSecond: 3, MessagesPerMinute: 60, EditsPerMinute: 30, TypingPerSecond: 2, ChannelHistoryLimit: 10000, PrivateHistoryLimit: 5000, RetentionDays: 90}
	c.Screen = ScreenConfig{Enabled: true, MaxSharesPerChannel: 4, MaxBitrate: 16000000, MaxHeight: 2160, MaxFPS: 60}
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
	if c.Chat.MaxStoredMessages < 100 || c.Chat.MaxStoredMessages > 10000000 || c.Chat.MaxThreads < 1 || c.Chat.MaxThreads > 100000 || c.Chat.MaxMessageLength < 1 || c.Chat.MaxMessageLength > 8000 || c.Chat.MessagesPerSecond < 1 || c.Chat.MessagesPerSecond > 20 || c.Chat.MessagesPerMinute < 1 || c.Chat.MessagesPerMinute > 1000 || c.Chat.EditsPerMinute < 1 || c.Chat.EditsPerMinute > 1000 || c.Chat.TypingPerSecond < 1 || c.Chat.TypingPerSecond > 10 || c.Chat.ChannelHistoryLimit < 1 || c.Chat.ChannelHistoryLimit > 100000 || c.Chat.PrivateHistoryLimit < 1 || c.Chat.PrivateHistoryLimit > 100000 || c.Chat.RetentionDays < 1 || c.Chat.RetentionDays > 3650 {
		return c, fmt.Errorf("invalid chat limits")
	}
	if c.YouTube.MaxQueue < 1 || c.YouTube.MaxQueue > 1000 || c.YouTube.CommandsPerMinute < 1 || c.YouTube.CommandsPerMinute > 1000 || c.YouTube.ChangesPerMinute < 1 || c.YouTube.ChangesPerMinute > 100 {
		return c, fmt.Errorf("invalid YouTube limits")
	}
	if c.Screen.MaxSharesPerChannel < 1 || c.Screen.MaxSharesPerChannel > 20 || c.Screen.MaxBitrate < 100000 || c.Screen.MaxBitrate > 50000000 || c.Screen.MaxHeight < 360 || c.Screen.MaxHeight > 4320 || c.Screen.MaxFPS < 30 || c.Screen.MaxFPS > 60 {
		return c, fmt.Errorf("invalid screen limits")
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
