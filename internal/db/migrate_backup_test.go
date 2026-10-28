package db

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenMigrateFailureRestoresBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "vc.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.PutSetting("keep", "yes"); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()

	good, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	origMigrate := migrateFn
	t.Cleanup(func() { migrateFn = origMigrate })
	migrateFn = func(*Store) error {
		return os.ErrInvalid
	}

	if _, err := Open(path); err == nil {
		t.Fatal("expected migrate failure")
	}
	restored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != string(good) {
		t.Fatalf("database file was not restored after failed migrate")
	}
	// Re-open with real migrate still works.
	migrateFn = origMigrate
	store2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	var v string
	ok, err := store2.GetSetting("keep", &v)
	if err != nil || !ok || v != "yes" {
		t.Fatalf("ok=%v v=%q err=%v", ok, v, err)
	}
}
