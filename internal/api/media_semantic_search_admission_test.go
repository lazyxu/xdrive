package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

type photoHostForegroundSemanticStub struct {
	photointelligence.SemanticAnalyzer
	embed func(context.Context, string) (photointelligence.SemanticEmbedding, error)
}

func (a photoHostForegroundSemanticStub) EmbedText(
	ctx context.Context, text string,
) (photointelligence.SemanticEmbedding, error) {
	if a.embed == nil {
		return photointelligence.SemanticEmbedding{}, errors.New("unexpected model inference")
	}
	return a.embed(ctx, text)
}

func TestForegroundSemanticQueryHoldsSharedAdmissionUntilModelReturnsPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	analyzer := photoHostAdmissionFencedSemanticAnalyzer{
		server: &Server{DB: db},
		SemanticAnalyzer: photoHostForegroundSemanticStub{
			embed: func(inferenceCtx context.Context, text string) (photointelligence.SemanticEmbedding, error) {
				if text != "person on a beach" {
					return photointelligence.SemanticEmbedding{}, errors.New("unexpected query")
				}
				close(entered)
				select {
				case <-release:
					return photointelligence.SemanticEmbedding{Dimensions: 64}, nil
				case <-inferenceCtx.Done():
					return photointelligence.SemanticEmbedding{}, inferenceCtx.Err()
				}
			},
		},
	}
	done := make(chan error, 1)
	go func() {
		_, err := analyzer.EmbedText(ctx, "person on a beach")
		done <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("foreground text model was not admitted")
	}
	writer, acquired, err := sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if writer != nil {
		writer.Close()
	}
	if err != nil || acquired {
		t.Fatalf("exclusive maintenance overtook live search inference: %v / %v", acquired, err)
	}
	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("admitted foreground inference failed: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("foreground inference did not return")
	}
	writer, acquired, err = sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("completed foreground inference leaked shared lock: %v / %v", acquired, err)
	}
	writer.Close()
}

func TestForegroundSemanticQueryRejectsWriterFrozenAndMissingMigrationPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	calls := 0
	analyzer := photoHostAdmissionFencedSemanticAnalyzer{
		server: &Server{DB: db},
		SemanticAnalyzer: photoHostForegroundSemanticStub{
			embed: func(context.Context, string) (photointelligence.SemanticEmbedding, error) {
				calls++
				return photointelligence.SemanticEmbedding{}, nil
			},
		},
	}
	writer, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("cannot hold future exclusive writer: %v / %v", acquired, err)
	}
	if _, err := analyzer.EmbedText(context.Background(), "query"); err == nil || calls != 0 {
		writer.Close()
		t.Fatal("exclusive writer permitted new semantic inference")
	}
	writer.Close()

	if err := db.Create(&meta.PhotoHostAdmissionGate{Name: photoHostAdmissionSettingName, Revision: 1, Frozen: true}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := analyzer.EmbedText(context.Background(), "query"); err == nil || calls != 0 {
		t.Fatal("frozen host permitted foreground text inference")
	}
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).
		Where("name = ?", photoHostAdmissionSettingName).
		Updates(map[string]any{"revision": 2, "frozen": false}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := analyzer.EmbedText(context.Background(), "query"); err != nil || calls != 1 {
		t.Fatalf("unfrozen host must admit exactly one model call: %v / %d", err, calls)
	}
	if err := db.Migrator().DropTable(&meta.PhotoHostAdmissionGate{}); err != nil {
		t.Fatal(err)
	}
	if _, err := analyzer.EmbedText(context.Background(), "query"); err == nil || calls != 1 {
		t.Fatal("missing migration permitted semantic inference")
	}
}

func TestForegroundSemanticQueryCancellationAndSingleDBConnectionPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	called := 0
	analyzer := photoHostAdmissionFencedSemanticAnalyzer{
		server: &Server{DB: db},
		SemanticAnalyzer: photoHostForegroundSemanticStub{
			embed: func(ctx context.Context, _ string) (photointelligence.SemanticEmbedding, error) {
				called++
				return photointelligence.SemanticEmbedding{Dimensions: 64}, ctx.Err()
			},
		},
	}
	if _, err := analyzer.EmbedText(context.Background(), "query"); err != nil || called != 1 {
		t.Fatalf("single pooled DB connection cannot run model: %v / %d", err, called)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := analyzer.EmbedText(ctx, "query"); err == nil || called != 1 {
		t.Fatal("canceled request reached model inference")
	}
	if _, err := (photoHostAdmissionFencedSemanticAnalyzer{
		server:           &Server{},
		SemanticAnalyzer: analyzer.SemanticAnalyzer,
	}).EmbedText(context.Background(), "query"); err == nil || called != 1 {
		t.Fatal("missing PostgreSQL fence reached model inference")
	}
	writer, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("single-connection foreground inference did not release lease: %v / %v", acquired, err)
	}
	writer.Close()

	slowCtx, slowCancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer slowCancel()
	slowAnalyzer := photoHostAdmissionFencedSemanticAnalyzer{
		server: &Server{DB: db},
		SemanticAnalyzer: photoHostForegroundSemanticStub{
			embed: func(ctx context.Context, _ string) (photointelligence.SemanticEmbedding, error) {
				<-ctx.Done()
				return photointelligence.SemanticEmbedding{}, ctx.Err()
			},
		},
	}
	if _, err := slowAnalyzer.EmbedText(slowCtx, "query"); err == nil {
		t.Fatal("cancelled ongoing foreground text inference returned successful embedding")
	}
}
