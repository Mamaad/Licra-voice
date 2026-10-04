package permissions

import "testing"

func TestResolutionExhaustive(t *testing.T) {
	choices := []Effect{Allow, Deny, Inherit}
	for n := 0; n <= 6; n++ {
		total := 1
		for i := 0; i < n; i++ {
			total *= 3
		}
		for mask := 0; mask < total; mask++ {
			e := make([]Effect, n)
			x := mask
			hasAllow, hasDeny := false, false
			for i := range e {
				e[i] = choices[x%3]
				x /= 3
				hasAllow = hasAllow || e[i] == Allow
				hasDeny = hasDeny || e[i] == Deny
			}
			if Resolve(e) != (hasAllow && !hasDeny) {
				t.Fatal(e)
			}
		}
	}
}
func TestHierarchy(t *testing.T) {
	a, ok := Ancestors("c", map[string]string{"a": "", "b": "a", "c": "b"})
	if !ok || len(a) != 3 {
		t.Fatal(a)
	}
	for _, p := range []map[string]string{{"a": "b", "b": "a"}, {"a": "missing"}} {
		if _, ok := Ancestors("a", p); ok {
			t.Fatal(p)
		}
	}
}

func TestScopesAndOverrides(t *testing.T) {
	p := Policy{Parents: map[string]string{"a": "", "b": "a", "c": ""}, Assignments: map[string][]Assignment{"u": {{Role: "r", Channel: "a"}, {Role: "g"}}}, Rules: map[string]map[string]Effect{"r": {"channel.edit": Allow}, "g": {"channel.join": Allow}}, Overrides: map[string]map[string]map[string]Effect{"a": {"r": {"channel.edit": Deny}}}}
	if p.Allowed("u", "channel.edit", "b") || p.Allowed("u", "channel.edit", "") || p.Allowed("u", "channel.edit", "c") || !p.Allowed("u", "channel.join", "b") {
		t.Fatal("scope or deny")
	}
	delete(p.Overrides, "a")
	if !p.Allowed("u", "channel.edit", "b") {
		t.Fatal("inheritance")
	}
}
