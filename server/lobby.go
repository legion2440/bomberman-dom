package server

import "time"

const (
	waitWindow      = 20 * time.Second
	countdownWindow = 10 * time.Second
)

type lobbyPhase string

const (
	phaseWaiting    lobbyPhase = "waiting"
	phaseCollecting lobbyPhase = "collecting"
	phaseCountdown  lobbyPhase = "countdown"
	phasePlaying    lobbyPhase = "playing"
	phaseFinished   lobbyPhase = "finished"
)

type lobbyClock struct {
	phase             lobbyPhase
	waitDeadline      time.Time
	countdownDeadline time.Time
}

func newLobbyClock() lobbyClock {
	return lobbyClock{phase: phaseWaiting}
}

func (l *lobbyClock) onPlayerCount(now time.Time, count int, mode string) {
	if l.phase == phasePlaying || l.phase == phaseFinished {
		return
	}

	minimum := minimumPlayers(mode)
	if count < minimum {
		l.phase = phaseWaiting
		l.waitDeadline = time.Time{}
		l.countdownDeadline = time.Time{}
		return
	}

	switch mode {
	case modeCoop, modeTeams:
		if l.phase == phaseWaiting {
			l.beginCountdown(now)
		}
	default:
		if l.phase == phaseWaiting {
			l.phase = phaseCollecting
			l.waitDeadline = now.Add(waitWindow)
		}
		if count >= 4 && l.phase == phaseCollecting {
			l.beginCountdown(now)
		}
	}
}

func (l *lobbyClock) advance(now time.Time, count int, mode string) (started bool) {
	if count < minimumPlayers(mode) {
		l.onPlayerCount(now, count, mode)
		return false
	}

	switch l.phase {
	case phaseCollecting:
		if count >= 4 || (!l.waitDeadline.IsZero() && !now.Before(l.waitDeadline)) {
			l.beginCountdown(now)
		}
	case phaseCountdown:
		if !l.countdownDeadline.IsZero() && !now.Before(l.countdownDeadline) {
			l.phase = phasePlaying
			return true
		}
	}
	return false
}

func (l *lobbyClock) beginCountdown(now time.Time) {
	l.phase = phaseCountdown
	l.waitDeadline = time.Time{}
	l.countdownDeadline = now.Add(countdownWindow)
}

func (l lobbyClock) remaining(now time.Time) (waitSeconds, countdownSeconds int) {
	if l.phase == phaseCollecting && !l.waitDeadline.IsZero() {
		waitSeconds = ceilSeconds(l.waitDeadline.Sub(now))
	}
	if l.phase == phaseCountdown && !l.countdownDeadline.IsZero() {
		countdownSeconds = ceilSeconds(l.countdownDeadline.Sub(now))
	}
	return
}

func minimumPlayers(mode string) int {
	switch mode {
	case modeCoop:
		return 1
	case modeTeams:
		return 4
	default:
		return 2
	}
}

func ceilSeconds(d time.Duration) int {
	if d <= 0 {
		return 0
	}
	return int((d + time.Second - 1) / time.Second)
}
