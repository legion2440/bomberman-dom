package server

import (
	"testing"
	"time"
)

func TestLobbyTwoPlayersWaitThenCountdown(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()

	lobby.onPlayerCount(now, 1)
	if lobby.phase != phaseWaiting {
		t.Fatalf("one player phase = %q, want waiting", lobby.phase)
	}

	lobby.onPlayerCount(now, 2)
	if lobby.phase != phaseCollecting {
		t.Fatalf("two player phase = %q, want collecting", lobby.phase)
	}

	if lobby.advance(now.Add(19*time.Second), 2) {
		t.Fatal("game started before wait window")
	}
	if lobby.phase != phaseCollecting {
		t.Fatalf("phase after 19s = %q, want collecting", lobby.phase)
	}

	if lobby.advance(now.Add(20*time.Second), 2) {
		t.Fatal("game should enter countdown, not start immediately")
	}
	if lobby.phase != phaseCountdown {
		t.Fatalf("phase after 20s = %q, want countdown", lobby.phase)
	}

	if lobby.advance(now.Add(29*time.Second), 2) {
		t.Fatal("game started before 10 second countdown finished")
	}
	if !lobby.advance(now.Add(30*time.Second), 2) {
		t.Fatal("game did not start after 20s wait + 10s countdown")
	}
	if lobby.phase != phasePlaying {
		t.Fatalf("final phase = %q, want playing", lobby.phase)
	}
}

func TestLobbyFourthPlayerStartsCountdownEarly(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 2)

	lobby.onPlayerCount(now.Add(5*time.Second), 4)
	if lobby.phase != phaseCountdown {
		t.Fatalf("four players phase = %q, want countdown", lobby.phase)
	}

	if lobby.advance(now.Add(14*time.Second), 4) {
		t.Fatal("game started before early countdown finished")
	}
	if !lobby.advance(now.Add(15*time.Second), 4) {
		t.Fatal("game did not start after fourth player + 10 seconds")
	}
}

func TestLobbyResetsBelowTwoPlayers(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 2)
	lobby.onPlayerCount(now.Add(3*time.Second), 1)

	if lobby.phase != phaseWaiting {
		t.Fatalf("phase after drop = %q, want waiting", lobby.phase)
	}
	if !lobby.waitDeadline.IsZero() || !lobby.countdownDeadline.IsZero() {
		t.Fatal("deadlines were not cleared")
	}
}
