package protocol

import "testing"

func TestCompatibility(t *testing.T) {
	for _, x := range []struct {
		v    int
		c, m string
		ok   bool
	}{{1, "0.1.0", "0.1.0", true}, {1, "0.2.0", "0.1.0", true}, {1, "0.0.9", "0.1.0", false}, {2, "0.1.0", "0.1.0", false}, {1, "garbage", "0.1.0", false}, {1, "0.01.0", "0.1.0", false}} {
		if Compatible(x.v, x.c, x.m) != x.ok {
			t.Fatal(x)
		}
	}
}
