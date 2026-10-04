package permissions

type Effect string

const (
	Allow   Effect = "ALLOW"
	Deny    Effect = "DENY"
	Inherit Effect = "INHERIT"
)

func Resolve(effects []Effect) bool {
	allowed := false
	for _, e := range effects {
		if e == Deny {
			return false
		}
		if e == Allow {
			allowed = true
		}
	}
	return allowed
}
func Valid(p string) bool {
	for _, n := range Names {
		if p == n {
			return true
		}
	}
	return false
}
func ValidEffect(e Effect) bool { return e == Allow || e == Deny || e == Inherit }
func Ancestors(id string, parents map[string]string) ([]string, bool) {
	out := []string{}
	seen := map[string]bool{}
	for id != "" {
		if seen[id] || len(out) >= 64 {
			return nil, false
		}
		parent, exists := parents[id]
		if !exists {
			return nil, false
		}
		seen[id] = true
		out = append(out, id)
		id = parent
	}
	return out, true
}

type Assignment struct {
	Role    string
	Channel string
}
type Policy struct {
	Parents     map[string]string
	Assignments map[string][]Assignment
	Rules       map[string]map[string]Effect
	Overrides   map[string]map[string]map[string]Effect
}

func (p *Policy) Allowed(fp, permission, ch string) bool {
	if p == nil || !Valid(permission) {
		return false
	}
	ancestors, ok := Ancestors(ch, p.Parents)
	if !ok {
		return false
	}
	within := func(scope string) bool {
		if scope == "" {
			return true
		}
		for _, id := range ancestors {
			if id == scope {
				return true
			}
		}
		return false
	}
	effects := []Effect{}
	for _, a := range p.Assignments[fp] {
		if !within(a.Channel) {
			continue
		}
		effects = append(effects, p.Rules[a.Role][permission])
		for _, id := range ancestors {
			effects = append(effects, p.Overrides[id][a.Role][permission])
		}
	}
	return Resolve(effects)
}
