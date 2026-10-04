package protocol

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"time"
)

type Envelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	EventID   string          `json:"event_id,omitempty"`
	Timestamp string          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}

func Message(kind, id string, p any) Envelope {
	b, _ := json.Marshal(p)
	e := Envelope{Type: kind, RequestID: id, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Payload: b}
	if id == "" {
		e.EventID = uuid.NewString()
	}
	return e
}
func Compatible(version int, client, min string) bool {
	if version != Version {
		return false
	}
	a, e := Semver(client)
	if e != nil {
		return false
	}
	b, e := Semver(min)
	if e != nil {
		return false
	}
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return true
}
func Semver(s string) ([3]int, error) {
	var a [3]int
	p := strings.Split(s, ".")
	if len(p) != 3 {
		return a, fmt.Errorf("invalid SemVer")
	}
	for i, v := range p {
		if v == "" || len(v) > 8 || (len(v) > 1 && v[0] == '0') {
			return a, fmt.Errorf("invalid SemVer")
		}
		for _, c := range v {
			if c < '0' || c > '9' {
				return a, fmt.Errorf("invalid SemVer")
			}
		}
		n, e := strconv.Atoi(v)
		if e != nil {
			return a, e
		}
		a[i] = n
	}
	return a, nil
}
