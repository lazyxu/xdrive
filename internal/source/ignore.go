package source

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

const (
	MaxIgnoreRulesBytes = 64 << 10
	MaxIgnoreRuleLines  = 4096
)

type IgnoreMatcher struct {
	rules []ignoreRule
}

type ignoreRule struct {
	negated       bool
	directoryOnly bool
	re            *regexp.Regexp
	direct        *regexp.Regexp
}

func CompileIgnoreRules(raw string) (*IgnoreMatcher, error) {
	if len([]byte(raw)) > MaxIgnoreRulesBytes {
		return nil, fmt.Errorf("ignore rules exceed %d bytes", MaxIgnoreRulesBytes)
	}
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	lines := strings.Split(raw, "\n")
	if len(lines) > MaxIgnoreRuleLines {
		return nil, fmt.Errorf("ignore rules exceed %d lines", MaxIgnoreRuleLines)
	}

	out := &IgnoreMatcher{}
	for lineNo, rawLine := range lines {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		if strings.IndexByte(line, 0) >= 0 {
			return nil, fmt.Errorf("ignore rule line %d contains NUL", lineNo+1)
		}

		escapedPrefix := false
		if strings.HasPrefix(line, `\#`) || strings.HasPrefix(line, `\!`) {
			line = line[1:]
			escapedPrefix = true
		}
		if !escapedPrefix && strings.HasPrefix(line, "#") {
			continue
		}

		negated := false
		if !escapedPrefix && strings.HasPrefix(line, "!") {
			negated = true
			line = strings.TrimSpace(line[1:])
			if line == "" {
				return nil, fmt.Errorf("ignore rule line %d has empty negation", lineNo+1)
			}
		}

		line = strings.ReplaceAll(line, `\`, "/")
		line = strings.TrimPrefix(line, "./")
		anchored := strings.HasPrefix(line, "/")
		line = strings.TrimPrefix(line, "/")
		directoryOnly := strings.HasSuffix(line, "/")
		line = strings.TrimSuffix(line, "/")
		if line == "" {
			return nil, fmt.Errorf("ignore rule line %d is empty", lineNo+1)
		}
		if line == ".." || strings.HasPrefix(line, "../") {
			return nil, fmt.Errorf("ignore rule line %d escapes source root", lineNo+1)
		}

		hasSlash := strings.Contains(line, "/")
		body := globRegex(line)
		prefix := "^"
		if !anchored && !hasSlash {
			prefix = `(?:^|.*/)`
		}
		suffix := "$"
		if directoryOnly || !strings.HasSuffix(line, "**") {
			suffix = `(?:/.*)?$`
		}
		re, err := regexp.Compile(prefix + body + suffix)
		if err != nil {
			return nil, fmt.Errorf("ignore rule line %d: %w", lineNo+1, err)
		}
		direct, err := regexp.Compile(prefix + body + "$")
		if err != nil {
			return nil, fmt.Errorf("ignore rule line %d: %w", lineNo+1, err)
		}
		out.rules = append(out.rules, ignoreRule{
			negated: negated, directoryOnly: directoryOnly, re: re, direct: direct,
		})
	}
	return out, nil
}

func (m *IgnoreMatcher) Ignored(rel string, isDir bool) bool {
	if m == nil {
		return false
	}
	rel, err := NormalizeRelativePath(rel)
	if err != nil {
		return false
	}
	ignored := false
	for _, rule := range m.rules {
		if !rule.re.MatchString(rel) {
			continue
		}
		if rule.directoryOnly && !isDir && rule.direct.MatchString(rel) {
			continue
		}
		ignored = !rule.negated
	}
	return ignored
}

func NormalizeRelativePath(value string) (string, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, `\`, "/"))
	value = strings.TrimPrefix(value, "./")
	if value == "" {
		return "", fmt.Errorf("source path is required")
	}
	if strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("source path must be relative")
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("source path escapes root")
	}
	if len([]byte(clean)) > 2048 {
		return "", fmt.Errorf("source path is too long")
	}
	return clean, nil
}

func globRegex(pattern string) string {
	var b strings.Builder
	for i := 0; i < len(pattern); i++ {
		ch := pattern[i]
		if ch == '*' {
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				i++
				if i+1 < len(pattern) && pattern[i+1] == '/' {
					i++
					b.WriteString(`(?:.*/)?`)
				} else {
					b.WriteString(".*")
				}
			} else {
				b.WriteString(`[^/]*`)
			}
			continue
		}
		if ch == '?' {
			b.WriteString(`[^/]`)
			continue
		}
		if strings.ContainsRune(`.+()|{}^$[]\`, rune(ch)) {
			b.WriteByte('\\')
		}
		b.WriteByte(ch)
	}
	return b.String()
}
