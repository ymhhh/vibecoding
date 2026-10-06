package api

import (
	"net/http"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/ymhhh/vibecoding/internal/gitx"
	"github.com/ymhhh/vibecoding/internal/model"
)

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListProjects()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for i := range list {
		if list[i].CustomModelConfig != nil {
			pub := list[i].CustomModelConfig.Public()
			list[i].CustomModelConfig = &pub
		}
	}
	writeJSON(w, 200, list)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var p model.Project
	if err := decodeJSON(r, &p); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	if p.ID == "" {
		p.ID = "proj-" + uuid.NewString()[:8]
	}
	if p.BranchPrefixConfig == nil {
		bp := model.DefaultBranchPrefix()
		p.BranchPrefixConfig = &bp
	}
	if err := s.Store.UpsertProject(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	saved, _ := s.Store.GetProject(p.ID)
	writeJSON(w, 201, publicProject(saved))
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.Store.GetProject(id)
	if err != nil || existing == nil {
		writeErr(w, 404, "project not found")
		return
	}
	var p model.Project
	if err := decodeJSON(r, &p); err != nil {
		writeErr(w, 400, "invalid JSON")
		return
	}
	p.ID = id
	p.CreatedAt = existing.CreatedAt
	if err := s.Store.UpsertProject(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	saved, _ := s.Store.GetProject(id)
	writeJSON(w, 200, publicProject(saved))
}

func publicProject(p *model.Project) *model.Project {
	if p == nil {
		return nil
	}
	out := *p
	if out.CustomModelConfig != nil {
		pub := out.CustomModelConfig.Public()
		out.CustomModelConfig = &pub
	}
	return &out
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteProject(id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleListProjectCommits(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.Store.GetProject(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if p == nil {
		writeErr(w, 404, "project not found")
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, perr := strconv.Atoi(raw)
		if perr == nil && n > 0 {
			limit = n
		}
	}
	if limit > 50 {
		limit = 50
	}
	perRepo := limit
	if perRepo < 10 {
		perRepo = 10
	}
	var all []gitx.RepoCommit
	for _, repo := range p.GitRepos {
		info, serr := os.Stat(repo.Path)
		if serr != nil || !info.IsDir() {
			continue
		}
		list, lerr := gitx.RecentCommits(repo.Path, repo.Name, perRepo)
		if lerr != nil {
			continue
		}
		all = append(all, list...)
	}
	sort.SliceStable(all, func(i, j int) bool {
		ti, tj := parseCommitTime(all[i].Time), parseCommitTime(all[j].Time)
		if !ti.IsZero() && !tj.IsZero() {
			return ti.After(tj)
		}
		return all[i].Time > all[j].Time
	})
	if len(all) > limit {
		all = all[:limit]
	}
	if all == nil {
		all = []gitx.RepoCommit{}
	}
	writeJSON(w, 200, map[string]any{"commits": all})
}

func parseCommitTime(raw string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t
		}
	}
	return time.Time{}
}
