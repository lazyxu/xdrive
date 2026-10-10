package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminPostgresPoolClientTransport(t *testing.T) {
	input := AdminPostgresPoolUpdate{
		Revision: 7,
		Desired:  AdminPostgresPoolValues{MaxOpenConnections: 32, MaxIdleConnections: 8},
	}
	rollback := AdminPostgresPoolRollbackInput{Revision: 8, TargetRevision: 3}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer postgres-pool-admin" {
			t.Errorf("PostgreSQL pool auth was not forwarded")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/admin/services/postgresql/pool":
			if r.Method == http.MethodPut {
				var got AdminPostgresPoolUpdate
				if err := json.NewDecoder(r.Body).Decode(&got); err != nil || got != input {
					t.Errorf("PostgreSQL pool update lost desired revision: %+v %v", got, err)
				}
			} else if r.Method != http.MethodGet {
				t.Errorf("invalid HTTP method: %s", r.Method)
			}
			_, _ = w.Write([]byte(`{"desired":{"max_open_connections":32,"max_idle_connections":8},"effective":{"max_open_connections":32,"max_idle_connections":8},"revision":8,"effective_revision":8,"source":"saved","apply_state":"applied","editable":true,"current_max_open_connections":32,"replicas":{"state":"pending","observed_instances":2,"applied_instances":1,"pending_instances":1,"unmanaged_instances":0,"truncated":false,"limits_consistent":false,"policy_groups":[{"revision":8,"max_open_connections":32,"max_idle_connections":8,"count":1}]}}`))
		case "/api/v1/admin/services/postgresql/pool/revisions":
			if r.Method != http.MethodGet {
				t.Errorf("history used wrong method: %s", r.Method)
			}
			_, _ = w.Write([]byte(`{"items":[{"revision":3,"origin":"saved","desired":{"max_open_connections":16,"max_idle_connections":4}}]}`))
		case "/api/v1/admin/services/postgresql/pool/rollback":
			if r.Method != http.MethodPost {
				t.Errorf("rollback used wrong method: %s", r.Method)
			}
			var got AdminPostgresPoolRollbackInput
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil || got != rollback {
				t.Errorf("PostgreSQL pool rollback lost revisions: %+v %v", got, err)
			}
			_, _ = w.Write([]byte(`{"desired":{"max_open_connections":16,"max_idle_connections":4},"effective":{"max_open_connections":16,"max_idle_connections":4},"revision":9,"effective_revision":9,"source":"saved","apply_state":"applied","editable":true}`))
		default:
			t.Errorf("unregistered pool route: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cli := New(server.URL, "postgres-pool-admin")
	updated, err := cli.UpdateAdminPostgresPool(context.Background(), input)
	if err != nil || updated.Revision != 8 || updated.Effective == nil ||
		updated.Effective.MaxOpenConnections != 32 || updated.ApplyState != "applied" {
		t.Fatalf("PostgreSQL pool update not transported: %+v %v", updated, err)
	}
	cfg, err := cli.AdminPostgresPoolConfig(context.Background())
	if err != nil || cfg.CurrentMaxOpen != 32 || cfg.Replicas == nil || cfg.Replicas.State != "pending" ||
		cfg.Replicas.ObservedInstances != 2 || len(cfg.Replicas.PolicyGroups) != 1 {
		t.Fatalf("PostgreSQL pool status missing: %+v %v", cfg, err)
	}
	history, err := cli.AdminPostgresPoolRevisions(context.Background())
	if err != nil || len(history.Items) != 1 || history.Items[0].Revision != 3 {
		t.Fatalf("PostgreSQL pool history missing: %+v %v", history, err)
	}
	restored, err := cli.RollbackAdminPostgresPool(context.Background(), rollback)
	if err != nil || restored.Revision != 9 || restored.Desired.MaxOpenConnections != 16 || calls != 4 {
		t.Fatalf("PostgreSQL pool rollback transport failed: %+v %v (%d calls)", restored, err, calls)
	}
}
