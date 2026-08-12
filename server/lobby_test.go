package server

import (
	"testing"
	"time"
)

func TestLobbyTwoPlayersWaitThenCountdown(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()

	lobby.onPlayerCount(now, 1, modeClassic)
	if lobby.phase != phaseWaiting {
		t.Fatalf("one player phase = %q, want waiting", lobby.phase)
	}

	lobby.onPlayerCount(now, 2, modeClassic)
	if lobby.phase != phaseCollecting {
		t.Fatalf("two player phase = %q, want collecting", lobby.phase)
	}

	if lobby.advance(now.Add(19*time.Second), 2, modeClassic) {
		t.Fatal("game started before wait window")
	}
	if lobby.phase != phaseCollecting {
		t.Fatalf("phase after 19s = %q, want collecting", lobby.phase)
	}

	if lobby.advance(now.Add(20*time.Second), 2, modeClassic) {
		t.Fatal("game should enter countdown, not start immediately")
	}
	if lobby.phase != phaseCountdown {
		t.Fatalf("phase after 20s = %q, want countdown", lobby.phase)
	}

	if lobby.advance(now.Add(29*time.Second), 2, modeClassic) {
		t.Fatal("game started before 10 second countdown finished")
	}
	if !lobby.advance(now.Add(30*time.Second), 2, modeClassic) {
		t.Fatal("game did not start after 20s wait + 10s countdown")
	}
	if lobby.phase != phasePlaying {
		t.Fatalf("final phase = %q, want playing", lobby.phase)
	}
}

func TestLobbyFourthPlayerStartsCountdownEarly(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 2, modeClassic)

	lobby.onPlayerCount(now.Add(5*time.Second), 4, modeClassic)
	if lobby.phase != phaseCountdown {
		t.Fatalf("four players phase = %q, want countdown", lobby.phase)
	}

	if lobby.advance(now.Add(14*time.Second), 4, modeClassic) {
		t.Fatal("game started before early countdown finished")
	}
	if !lobby.advance(now.Add(15*time.Second), 4, modeClassic) {
		t.Fatal("game did not start after fourth player + 10 seconds")
	}
}

func TestLobbyResetsBelowTwoPlayers(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 2, modeClassic)
	lobby.onPlayerCount(now.Add(3*time.Second), 1, modeClassic)

	if lobby.phase != phaseWaiting {
		t.Fatalf("phase after drop = %q, want waiting", lobby.phase)
	}
	if !lobby.waitDeadline.IsZero() || !lobby.countdownDeadline.IsZero() {
		t.Fatal("deadlines were not cleared")
	}
}

func TestCoopStartsCountdownWithOnePlayer(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 1, modeCoop)
	if lobby.phase != phaseCountdown {
		t.Fatalf("coop phase = %q, want countdown", lobby.phase)
	}
	if !lobby.advance(now.Add(10*time.Second), 1, modeCoop) {
		t.Fatal("coop did not start after 10 second countdown")
	}
}

func TestTeamsWaitForFourPlayers(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lobby := newLobbyClock()
	lobby.onPlayerCount(now, 3, modeTeams)
	if lobby.phase != phaseWaiting {
		t.Fatalf("teams phase with 3 players = %q, want waiting", lobby.phase)
	}
	lobby.onPlayerCount(now, 4, modeTeams)
	if lobby.phase != phaseCountdown {
		t.Fatalf("teams phase with 4 players = %q, want countdown", lobby.phase)
	}
}

func TestFinishedRoomResetsAfterGrace(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	r := &room{
		clients: map[string]*client{
			"a": {id: "a", slot: 0},
			"b": {id: "b", slot: 1},
			"c": {id: "c", slot: 2},
			"d": {id: "d", slot: 3},
		},
		clock: newLobbyClock(),
		mode:  modeClassic,
	}
	r.markFinished(now)

	if r.resetFinishedIfDue(now.Add(finishedGrace - time.Millisecond)) {
		t.Fatal("finished room reset before grace period elapsed")
	}
	if r.clock.phase != phaseFinished {
		t.Fatalf("phase before grace = %q, want finished", r.clock.phase)
	}

	if !r.resetFinishedIfDue(now.Add(finishedGrace)) {
		t.Fatal("finished room did not reset after grace period")
	}
	if r.clock.phase != phaseCountdown {
		t.Fatalf("four connected players after reset = %q, want countdown", r.clock.phase)
	}
	if !r.finishedAt.IsZero() {
		t.Fatal("finishedAt was not cleared after reset")
	}
}
