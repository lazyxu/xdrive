// media-query-overlay keeps both benchmark arms on the current DTO/test tree
// while replacing only the production query path with its frozen baseline.
package main

import (
	"flag"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strings"
)

var queryFunctions = []string{"mediaItemsBaseQuery", "materializeMediaItems", "queryMediaTimelineGroupSets", "queryMediaItemRange"}

type declaration struct {
	start, end int
	text       []byte
}

func declarations(source []byte) (map[string]declaration, error) {
	set := token.NewFileSet()
	file, err := parser.ParseFile(set, "media.go", source, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	out := make(map[string]declaration)
	for _, item := range file.Decls {
		if function, ok := item.(*ast.FuncDecl); ok {
			start, end := set.Position(function.Pos()).Offset, set.Position(function.End()).Offset
			if _, duplicate := out[function.Name.Name]; duplicate {
				return nil, fmt.Errorf("ambiguous function %s", function.Name.Name)
			}
			out[function.Name.Name] = declaration{start, end, source[start:end]}
		}
	}
	return out, nil
}

func overlay(current, baseline []byte, functions []string) ([]byte, error) {
	after, err := declarations(current)
	if err != nil {
		return nil, err
	}
	before, err := declarations(baseline)
	if err != nil {
		return nil, err
	}
	type replacement struct {
		declaration
		before []byte
	}
	var replacements []replacement
	for _, name := range functions {
		a, present := after[name]
		b, existed := before[name]
		if !present || !existed {
			return nil, fmt.Errorf("query function %s absent from one arm", name)
		}
		replacements = append(replacements, replacement{a, b.text})
	}
	sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })
	out := append([]byte(nil), current...)
	for _, change := range replacements {
		next := append([]byte(nil), out[:change.start]...)
		next = append(next, change.before...)
		out = append(next, out[change.end:]...)
	}
	return format.Source(out)
}

func main() {
	current := flag.String("current", "", "current media.go")
	baseline := flag.String("baseline", "", "frozen baseline media.go")
	output := flag.String("output", "", "output media.go")
	names := flag.String("functions", strings.Join(queryFunctions, ","), "comma-separated query functions to freeze")
	flag.Parse()
	if *current == "" || *baseline == "" || *output == "" {
		panic("all paths are required")
	}
	a, err := os.ReadFile(*current)
	if err != nil {
		panic(err)
	}
	b, err := os.ReadFile(*baseline)
	if err != nil {
		panic(err)
	}
	result, err := overlay(a, b, strings.Split(*names, ","))
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(*output, result, 0600); err != nil {
		panic(err)
	}
}
