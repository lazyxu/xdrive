package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/lazyxu/xdrive/internal/diagnostics"
)

type doctorCheck = diagnostics.Check

const (
	doctorPass = diagnostics.Pass
	doctorWarn = diagnostics.Warn
	doctorFail = diagnostics.Fail
)

func doctorCmd(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	strict := fs.Bool("strict", false, "exit non-zero when a diagnostic check fails")
	if err := fs.Parse(args); err != nil {
		return err
	}

	report := diagnostics.Run(context.Background())
	fmt.Print(diagnostics.FormatText(report))
	if *strict && report.Summary.Fail > 0 {
		return fmt.Errorf("doctor found %d failing check(s)", report.Summary.Fail)
	}
	return nil
}

func runDoctorChecks() []doctorCheck {
	return diagnostics.Run(context.Background()).Checks
}

func doctorServerChecks(server string) []doctorCheck {
	return diagnostics.ServerChecks(context.Background(), server)
}

func shortDoctorID(v string) string      { return diagnostics.ShortID(v) }
func maskDoctorUser(v string) string     { return diagnostics.MaskUser(v) }
func doctorPath(v string) string         { return diagnostics.DisplayPath(v) }
func redactDoctorDetail(v string) string { return diagnostics.RedactDetail(v) }
