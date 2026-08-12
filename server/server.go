package server

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxPlayers       = 4
	maxNicknameRunes = 18
	maxChatRunes     = 240

	modeClassic = "classic"
	modeCoop    = "coop"
	modeTeams   = "teams"
	modeGhosts  = "ghosts"
)

type wireMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

type playerInfo struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Slot     int    `json:"slot"`
	Host     bool   `json:"host"`
}

type lobbyPayload struct {
	Mode               string       `json:"mode"`
	Players            []playerInfo `json:"players"`
	Phase              lobbyPhase   `json:"phase"`
	WaitRemaining      int          `json:"waitRemaining"`
	CountdownRemaining int          `json:"countdownRemaining"`
}

type joinedPayload struct {
	ID   string `json:"id"`
	Slot int    `json:"slot"`
}

type chatPayload struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Text     string `json:"text"`
	At       string `json:"at"`
}

type client struct {
	id       string
	nickname string
	slot     int
	room     *room
	conn     *wsConn
	send     chan []byte
	joined   bool
}

type room struct {
	mu      sync.Mutex
	clients map[string]*client
	clock   lobbyClock
	mode    string
}

type hub struct {
	mu   sync.Mutex
	room *room
}

func newHub() *hub {
	return &hub{
		room: &room{
			clients: make(map[string]*client),
			clock:   newLobbyClock(),
			mode:    modeClassic,
		},
	}
}

func Run(port string) error {
	h := newHub()
	go h.lobbyLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.websocketHandler)
	mux.Handle("/", http.FileServer(http.Dir("public")))

	addr := ":" + port
	log.Printf("Bomberman DOM is running on http://localhost%s", addr)
	log.Printf("LAN address: http://%s%s", localIP(), addr)
	return http.ListenAndServe(addr, mux)
}

func (h *hub) websocketHandler(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || r.Header.Get("Sec-WebSocket-Key") == "" {
		http.Error(w, "expected websocket upgrade", http.StatusBadRequest)
		return
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket unsupported", http.StatusInternalServerError)
		return
	}

	netConn, rw, err := hijacker.Hijack()
	if err != nil {
		return
	}

	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + websocketAccept(r.Header.Get("Sec-WebSocket-Key")) + "\r\n\r\n"
	if _, err := rw.WriteString(response); err != nil {
		_ = netConn.Close()
		return
	}
	if err := rw.Flush(); err != nil {
		_ = netConn.Close()
		return
	}

	c := &client{
		id:   randomID(8),
		slot: -1,
		room: h.room,
		conn: newWSConn(netConn, rw.Reader, rw.Writer),
		send: make(chan []byte, 64),
	}
	go c.writeLoop()
	c.readLoop(h)
}

func (c *client) readLoop(h *hub) {
	defer h.removeClient(c)
	for {
		payload, err := c.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg wireMessage
		if err := json.Unmarshal(payload, &msg); err != nil {
			h.sendError(c, "invalid JSON message")
			continue
		}

		switch msg.Type {
		case "join":
			h.handleJoin(c, msg.Data)
		case "chat":
			h.handleChat(c, msg.Data)
		case "input":
			h.handleInput(c, msg.Data)
		case "state":
			h.handleState(c, msg.Data)
		case "game_over":
			h.handleGameOver(c, msg.Data)
		default:
			h.sendError(c, "unknown message type")
		}
	}
}

func (c *client) writeLoop() {
	for payload := range c.send {
		if err := c.conn.WriteMessage(payload); err != nil {
			return
		}
	}
}

func (h *hub) handleJoin(c *client, raw json.RawMessage) {
	var data struct {
		Nickname string `json:"nickname"`
		Mode     string `json:"mode"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		h.sendError(c, "invalid join payload")
		return
	}

	nickname := cleanNickname(data.Nickname)
	if nickname == "" {
		h.sendError(c, "nickname is required")
		return
	}

	r := h.room
	r.mu.Lock()
	defer r.mu.Unlock()

	if c.joined {
		return
	}
	if r.clock.phase == phasePlaying {
		h.sendErrorLocked(c, "game already in progress")
		return
	}
	if r.clock.phase == phaseFinished {
		h.sendErrorLocked(c, "match finished; reload to start a new room")
		return
	}
	if len(r.clients) == 0 {
		r.mode = sanitizeMode(data.Mode)
	}
	if len(r.clients) >= maxPlayers {
		h.sendErrorLocked(c, "room is full")
		return
	}

	slot := firstFreeSlotLocked(r)
	if slot < 0 {
		h.sendErrorLocked(c, "room is full")
		return
	}

	c.nickname = uniqueNicknameLocked(r, nickname)
	c.slot = slot
	c.joined = true
	r.clients[c.id] = c

	r.clock.onPlayerCount(time.Now(), len(r.clients), r.mode)
	h.sendLocked(c, "joined", joinedPayload{ID: c.id, Slot: c.slot})
	h.broadcastLobbyLocked(r, time.Now())
}

func (h *hub) handleChat(c *client, raw json.RawMessage) {
	if !c.joined {
		h.sendError(c, "join before chatting")
		return
	}

	var data struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		h.sendError(c, "invalid chat payload")
		return
	}
	text := strings.TrimSpace(data.Text)
	if text == "" {
		return
	}
	text = truncateRunes(text, maxChatRunes)

	r := h.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if !c.joined {
		return
	}
	h.broadcastLocked(r, "chat", chatPayload{
		ID:       c.id,
		Nickname: c.nickname,
		Text:     text,
		At:       time.Now().UTC().Format(time.RFC3339),
	}, "")
}

func (h *hub) handleInput(c *client, raw json.RawMessage) {
	if !c.joined {
		return
	}
	r := h.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.clock.phase != phasePlaying || isHostLocked(r, c.id) {
		return
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return
	}
	h.broadcastLocked(r, "input", map[string]any{
		"clientId": c.id,
		"input":    data,
	}, hostIDLocked(r))
}

func (h *hub) handleState(c *client, raw json.RawMessage) {
	if !c.joined {
		return
	}
	r := h.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.clock.phase != phasePlaying || !isHostLocked(r, c.id) || len(raw) > 256*1024 {
		return
	}
	h.broadcastRawLocked(r, "state", raw, c.id)
}

func (h *hub) handleGameOver(c *client, raw json.RawMessage) {
	r := h.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.clock.phase != phasePlaying || !isHostLocked(r, c.id) {
		return
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		data = map[string]any{}
	}
	r.clock.phase = phaseFinished
	h.broadcastLocked(r, "game_over", data, "")
	h.broadcastLobbyLocked(r, time.Now())
}

func (h *hub) removeClient(c *client) {
	r := h.room
	r.mu.Lock()
	if c.joined {
		wasHost := isHostLocked(r, c.id)
		delete(r.clients, c.id)
		c.joined = false

		if len(r.clients) == 0 {
			r.clock = newLobbyClock()
			r.mode = modeClassic
		} else if r.clock.phase == phasePlaying && wasHost {
			r.clock.phase = phaseFinished
			h.broadcastLocked(r, "game_over", map[string]any{
				"winnerId":       "",
				"winnerNickname": "",
				"reason":         "host disconnected",
			}, "")
		} else {
			r.clock.onPlayerCount(time.Now(), len(r.clients), r.mode)
		}
		if len(r.clients) > 0 {
			h.broadcastLobbyLocked(r, time.Now())
		}
	}
	r.mu.Unlock()

	close(c.send)
	_ = c.conn.Close()
}

func (h *hub) lobbyLoop() {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	for now := range ticker.C {
		r := h.room
		r.mu.Lock()
		if r.clock.advance(now, len(r.clients), r.mode) {
			players := playersLocked(r)
			h.broadcastLocked(r, "game_start", map[string]any{"players": players, "mode": r.mode}, "")
		}
		if len(r.clients) > 0 && (r.clock.phase == phaseCollecting || r.clock.phase == phaseCountdown) {
			h.broadcastLobbyLocked(r, now)
		}
		r.mu.Unlock()
	}
}

func (h *hub) broadcastLobbyLocked(r *room, now time.Time) {
	waitRemaining, countdownRemaining := r.clock.remaining(now)
	h.broadcastLocked(r, "lobby", lobbyPayload{
		Mode:               r.mode,
		Players:            playersLocked(r),
		Phase:              r.clock.phase,
		WaitRemaining:      waitRemaining,
		CountdownRemaining: countdownRemaining,
	}, "")
}

func playersLocked(r *room) []playerInfo {
	players := make([]playerInfo, 0, len(r.clients))
	hostID := hostIDLocked(r)
	for slot := 0; slot < maxPlayers; slot++ {
		for _, c := range r.clients {
			if c.slot == slot {
				players = append(players, playerInfo{
					ID:       c.id,
					Nickname: c.nickname,
					Slot:     c.slot,
					Host:     c.id == hostID,
				})
				break
			}
		}
	}
	return players
}

func firstFreeSlotLocked(r *room) int {
	used := make(map[int]bool, len(r.clients))
	for _, c := range r.clients {
		used[c.slot] = true
	}
	for slot := 0; slot < maxPlayers; slot++ {
		if !used[slot] {
			return slot
		}
	}
	return -1
}

func hostIDLocked(r *room) string {
	bestSlot := maxPlayers + 1
	bestID := ""
	for _, c := range r.clients {
		if c.slot < bestSlot {
			bestSlot = c.slot
			bestID = c.id
		}
	}
	return bestID
}

func isHostLocked(r *room, id string) bool {
	return id != "" && hostIDLocked(r) == id
}

func uniqueNicknameLocked(r *room, requested string) string {
	used := map[string]bool{}
	for _, c := range r.clients {
		used[strings.ToLower(c.nickname)] = true
	}
	if !used[strings.ToLower(requested)] {
		return requested
	}
	for i := 2; i <= 99; i++ {
		suffix := fmt.Sprintf("-%d", i)
		base := truncateRunes(requested, maxNicknameRunes-len([]rune(suffix)))
		candidate := base + suffix
		if !used[strings.ToLower(candidate)] {
			return candidate
		}
	}
	return requested
}

func (h *hub) sendError(c *client, text string) {
	c.room.mu.Lock()
	defer c.room.mu.Unlock()
	h.sendErrorLocked(c, text)
}

func (h *hub) sendErrorLocked(c *client, text string) {
	h.sendLocked(c, "error", map[string]string{"message": text})
}

func (h *hub) sendLocked(c *client, kind string, data any) {
	payload, err := marshalWire(kind, data)
	if err != nil {
		return
	}
	select {
	case c.send <- payload:
	default:
	}
}

func (h *hub) broadcastLocked(r *room, kind string, data any, onlyID string) {
	payload, err := marshalWire(kind, data)
	if err != nil {
		return
	}
	for id, c := range r.clients {
		if onlyID != "" && id != onlyID {
			continue
		}
		select {
		case c.send <- payload:
		default:
		}
	}
}

func (h *hub) broadcastRawLocked(r *room, kind string, raw json.RawMessage, exceptID string) {
	envelope, err := json.Marshal(struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}{Type: kind, Data: raw})
	if err != nil {
		return
	}
	for id, c := range r.clients {
		if id == exceptID {
			continue
		}
		select {
		case c.send <- envelope:
		default:
		}
	}
}

func marshalWire(kind string, data any) ([]byte, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(wireMessage{Type: kind, Data: raw})
}

func sanitizeMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case modeCoop:
		return modeCoop
	case modeTeams:
		return modeTeams
	case modeGhosts:
		return modeGhosts
	default:
		return modeClassic
	}
}

func cleanNickname(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	return truncateRunes(value, maxNicknameRunes)
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

func randomID(size int) string {
	if size <= 0 {
		return ""
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	value := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	if len(value) > size {
		return value[:size]
	}
	return value
}

func localIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "localhost"
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			if ip := ipNet.IP.To4(); ip != nil {
				return ip.String()
			}
		}
	}
	return "localhost"
}
