package server

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

const (
	wsReadTimeout  = 60 * time.Second
	wsWriteTimeout = 5 * time.Second
)

type wsConn struct {
	conn   net.Conn
	reader *bufio.Reader
	writer *bufio.Writer
	mu     sync.Mutex
}

func newWSConn(conn net.Conn, reader *bufio.Reader, writer *bufio.Writer) *wsConn {
	return &wsConn{conn: conn, reader: reader, writer: writer}
}

func (w *wsConn) ReadMessage() ([]byte, error) {
	for {
		if err := w.conn.SetReadDeadline(time.Now().Add(wsReadTimeout)); err != nil {
			return nil, err
		}
		b1, err := w.reader.ReadByte()
		if err != nil {
			return nil, err
		}
		b2, err := w.reader.ReadByte()
		if err != nil {
			return nil, err
		}

		fin := b1&0x80 != 0
		opcode := b1 & 0x0f
		if !fin {
			return nil, fmt.Errorf("fragmented websocket frames are not supported")
		}

		masked := b2&0x80 != 0
		length := int64(b2 & 0x7f)
		switch length {
		case 126:
			var buf [2]byte
			if _, err := io.ReadFull(w.reader, buf[:]); err != nil {
				return nil, err
			}
			length = int64(binary.BigEndian.Uint16(buf[:]))
		case 127:
			var buf [8]byte
			if _, err := io.ReadFull(w.reader, buf[:]); err != nil {
				return nil, err
			}
			raw := binary.BigEndian.Uint64(buf[:])
			if raw > 1<<20 {
				return nil, fmt.Errorf("websocket frame too large")
			}
			length = int64(raw)
		}

		if length > 1<<20 {
			return nil, fmt.Errorf("websocket frame too large")
		}

		var mask [4]byte
		if masked {
			if _, err := io.ReadFull(w.reader, mask[:]); err != nil {
				return nil, err
			}
		}

		payload := make([]byte, length)
		if _, err := io.ReadFull(w.reader, payload); err != nil {
			return nil, err
		}
		if masked {
			for i := range payload {
				payload[i] ^= mask[i%4]
			}
		}

		switch opcode {
		case 0x1:
			return payload, nil
		case 0x8:
			return nil, io.EOF
		case 0x9:
			if err := w.writeFrame(0xA, payload); err != nil {
				return nil, err
			}
		case 0xA:
			continue
		default:
			return nil, fmt.Errorf("unsupported websocket opcode %d", opcode)
		}
	}
}

func (w *wsConn) WriteMessage(payload []byte) error {
	return w.writeFrame(0x1, payload)
}

func (w *wsConn) WritePing() error {
	return w.writeFrame(0x9, nil)
}

func (w *wsConn) writeFrame(opcode byte, payload []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout)); err != nil {
		return err
	}

	header := []byte{0x80 | opcode}
	size := len(payload)
	switch {
	case size < 126:
		header = append(header, byte(size))
	case size <= 65535:
		header = append(header, 126, byte(size>>8), byte(size))
	default:
		header = append(header, 127, 0, 0, 0, 0, byte(size>>24), byte(size>>16), byte(size>>8), byte(size))
	}

	if _, err := w.writer.Write(header); err != nil {
		return err
	}
	if _, err := w.writer.Write(payload); err != nil {
		return err
	}
	return w.writer.Flush()
}

func (w *wsConn) Close() error {
	return w.conn.Close()
}

func websocketAccept(key string) string {
	const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	sum := sha1.Sum([]byte(key + guid))
	return base64.StdEncoding.EncodeToString(sum[:])
}
