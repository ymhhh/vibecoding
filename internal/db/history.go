package db

import (
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/model"
	"github.com/ymhhh/vibecoding/internal/version"
)

// AppendHistoryEvent writes one history row. Payload must not contain API keys.
func (s *Store) AppendHistoryEvent(ev model.HistoryEvent) (*model.HistoryEvent, error) {
	if strings.TrimSpace(ev.ID) == "" {
		ev.ID = "hist-" + uuid.NewString()[:10]
	}
	if strings.TrimSpace(ev.CreatedAt) == "" {
		ev.CreatedAt = model.NowISO()
	}
	if strings.TrimSpace(ev.AppVersion) == "" {
		ev.AppVersion = version.Version
	}
	if ev.Payload == nil {
		ev.Payload = map[string]any{}
	}
	raw, err := json.Marshal(sanitizeHistoryPayload(ev.Payload))
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(`
INSERT INTO history_events(id, issue_id, event_type, model, app_version, payload, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?)
`, ev.ID, ev.IssueID, ev.EventType, ev.Model, ev.AppVersion, string(raw), ev.CreatedAt)
	if err != nil {
		return nil, err
	}
	ev.Payload = sanitizeHistoryPayload(ev.Payload)
	return &ev, nil
}

func sanitizeHistoryPayload(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "apikey") || strings.Contains(lk, "api_key") ||
			strings.Contains(lk, "token") || strings.Contains(lk, "secret") ||
			strings.Contains(lk, "password") || strings.Contains(lk, "authorization") {
			continue
		}
		out[k] = v
	}
	return out
}

// ListHistoryEvents returns newest-first history for an issue (empty issueID → global/settings events only).
func (s *Store) ListHistoryEvents(issueID string, limit int) ([]model.HistoryEvent, error) {
	if limit <= 0 {
		limit = 200
	}
	var rows *sql.Rows
	var err error
	if strings.TrimSpace(issueID) == "" {
		rows, err = s.db.Query(`
SELECT id, issue_id, event_type, model, app_version, payload, created_at
FROM history_events WHERE issue_id = '' ORDER BY created_at DESC LIMIT ?
`, limit)
	} else {
		rows, err = s.db.Query(`
SELECT id, issue_id, event_type, model, app_version, payload, created_at
FROM history_events WHERE issue_id = ? ORDER BY created_at DESC LIMIT ?
`, issueID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHistoryRows(rows)
}

// ClearAllAgentSessionIDs drops CLI session ids on every issue so a new executor
// cannot resume the previous session (#37). History and worktree records stay.
func (s *Store) ClearAllAgentSessionIDs() error {
	list, err := s.ListIssues("")
	if err != nil {
		return err
	}
	for i := range list {
		if strings.TrimSpace(list[i].AgentSessionID) == "" {
			continue
		}
		list[i].AgentSessionID = ""
		if err := s.UpsertIssue(list[i]); err != nil {
			return err
		}
	}
	return nil
}

// LatestFocusedIssue returns the most recent session_focus / work event with a real issue id.
func (s *Store) LatestFocusedIssue() (issueID string, err error) {
	err = s.db.QueryRow(`
SELECT issue_id FROM history_events
WHERE issue_id != '' AND event_type IN ('session_focus', 'chat', 'accept_requirement', 'accept_design', 'coding_start', 'coding_finish')
ORDER BY created_at DESC LIMIT 1
`).Scan(&issueID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return issueID, err
}

func scanHistoryRows(rows *sql.Rows) ([]model.HistoryEvent, error) {
	var out []model.HistoryEvent
	for rows.Next() {
		var ev model.HistoryEvent
		var raw string
		if err := rows.Scan(&ev.ID, &ev.IssueID, &ev.EventType, &ev.Model, &ev.AppVersion, &raw, &ev.CreatedAt); err != nil {
			return nil, err
		}
		ev.Payload = map[string]any{}
		if strings.TrimSpace(raw) != "" {
			_ = json.Unmarshal([]byte(raw), &ev.Payload)
		}
		out = append(out, ev)
	}
	if out == nil {
		out = []model.HistoryEvent{}
	}
	return out, rows.Err()
}
