package db

import (
	"encoding/json"
	"reflect"
	"strings"
)

// mergeTypedIntoDocument overlays a typed JSON marshal onto an existing document map
// so unrecognized older fields are preserved across upserts.
//
// Known typed keys that are omitted by omitempty (cleared / zero) are removed from
// the stored document so clears stick; only keys absent from the typed schema are kept.
func mergeTypedIntoDocument(existingRaw string, typed any) (string, error) {
	base := map[string]json.RawMessage{}
	if strings.TrimSpace(existingRaw) != "" {
		if err := json.Unmarshal([]byte(existingRaw), &base); err != nil {
			// Corrupt legacy blob: start fresh rather than failing the write.
			base = map[string]json.RawMessage{}
		}
	}
	known := jsonFieldNames(typed)
	typedBytes, err := json.Marshal(typed)
	if err != nil {
		return "", err
	}
	overlay := map[string]json.RawMessage{}
	if err := json.Unmarshal(typedBytes, &overlay); err != nil {
		return "", err
	}
	out := map[string]json.RawMessage{}
	for k, v := range base {
		if _, isKnown := known[k]; !isKnown {
			out[k] = v
		}
	}
	for k, v := range overlay {
		out[k] = v
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func jsonFieldNames(v any) map[string]struct{} {
	names := map[string]struct{}{}
	t := reflect.TypeOf(v)
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return names
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.PkgPath != "" { // unexported
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name := strings.Split(tag, ",")[0]
		if name == "" {
			name = f.Name
		}
		names[name] = struct{}{}
	}
	return names
}
