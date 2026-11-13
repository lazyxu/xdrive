import json
import os
import pathlib
import tempfile
import time
import unittest
from assert_native_ios_no_crash import audit, main


class NativeCrashAuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.marker = self.root / 'xcodebuild-start.marker'
        self.marker.write_text('')
        self.start = time.time_ns() - 30_000_000_000
        os.utime(self.marker, ns=(self.start, self.start))
        self.host = self.root / 'host'
        self.sim = self.root / 'sim'
        self.host.mkdir()
        self.sim.mkdir()

    def make_report(self, name, content='', *, root=None, before=False):
        path = (root or self.sim) / name
        path.write_text(content, encoding='utf-8')
        ns = self.start - 1_000_000_000 if before else self.start + 1_000_000_000
        os.utime(path, ns=(ns, ns))
        return path

    def test_clean_run_with_no_reports_passes(self):
        report = audit(self.marker, [self.host, self.sim])
        self.assertEqual(report['status'], 'pass')
        self.assertEqual(report['app_crash_report_count'], 0)

    def test_true_app_ips_fails_even_with_unparseable_body(self):
        self.make_report('xDriveIOS-2026-11-11.ips', 'broken JSON')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'fail')

    def test_app_crash_file_is_also_fatal(self):
        self.make_report('xDriveIOS_2026-11-11.crash', 'Process: xDriveIOS [42]')
        self.assertEqual(audit(self.marker, [self.sim])['app_crash_report_count'], 1)

    def test_unrelated_siri_widget_ips_not_app_crash(self):
        self.make_report('TypeToSiriWidgetExtension-2026.ips',
                         '{"procName":"TypeToSiriWidgetExtension", "note":"xDriveIOS"}')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'pass')

    def test_clipboard_share_extension_is_not_gallery_process(self):
        self.make_report('xDriveClipboardShare-2026.ips', '{"procName":"xDriveClipboardShare"}')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'pass')

    def test_generic_ips_with_exact_procname_is_detected(self):
        self.make_report('incident-1234.ips', '{"procName" : "xDriveIOS", "exception":{}}')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'fail')

    def test_generic_crash_with_exact_process_header_is_detected(self):
        self.make_report('incident-1234.crash', 'Process: xDriveIOS [109]\nIdentifier: com.lazyxu.xdrive.ios')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'fail')

    def test_parent_process_text_does_not_count_as_app(self):
        self.make_report('system-incident.ips', '{"procName":"searchd", "parentName":"xDriveIOS"}')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'pass')

    def test_stale_report_before_xcodebuild_is_ignored(self):
        self.make_report('xDriveIOS-previous.ips', '{}', before=True)
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'pass')

    def test_non_crash_extensions_do_not_count(self):
        self.make_report('xDriveIOS-console.txt', 'Process: xDriveIOS [42]')
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'pass')

    def test_host_and_sim_reports_both_checked(self):
        self.make_report('xDriveIOS-incident.ips', '{}', root=self.host)
        self.assertEqual(audit(self.marker, [self.host, self.sim])['status'], 'fail')


    def test_no_existing_report_roots_is_incomplete_not_clean(self):
        report = audit(self.marker, [self.root / 'absent-sim', self.root / 'absent-host'])
        self.assertEqual(report['status'], 'error')
        self.assertEqual(report['reason'], 'no_crash_report_roots_accessible')
        self.assertEqual(report['report_roots_checked'], 0)
        self.assertEqual(report['app_crash_report_count'], 0)

    def test_file_instead_of_report_directory_does_not_count_as_scanned(self):
        report = audit(self.marker, [self.marker])
        self.assertEqual(report['status'], 'error')
        self.assertEqual(report['report_roots_checked'], 0)

    def test_optional_missing_simulator_root_with_real_host_is_accepted(self):
        report = audit(self.marker, [self.host, self.root / 'missing-simulator'])
        self.assertEqual(report['status'], 'pass')
        self.assertEqual(report['report_roots_checked'], 1)

    def test_actual_app_crash_with_missing_optional_root_still_fails(self):
        self.make_report('xDriveIOS-fail-closed.ips', '{}')
        report = audit(self.marker, [self.root / 'missing-host', self.sim])
        self.assertEqual(report['status'], 'fail')
        self.assertEqual(report['app_crash_report_count'], 1)
        self.assertEqual(report['report_roots_checked'], 1)

    def test_cli_missing_report_root_returns_nonzero_with_machine_readable_error(self):
        dest = self.root / 'missing-root-audit.json'
        rc = main(['--marker', str(self.marker), '--output', str(dest),
                   str(self.root / 'missing-simulator')])
        self.assertEqual(rc, 1)
        report = json.loads(dest.read_text(encoding='utf-8'))
        self.assertEqual(report['status'], 'error')
        self.assertEqual(report['reason'], 'no_crash_report_roots_accessible')

    def test_missing_marker_is_not_falsely_passed(self):
        self.marker.unlink()
        self.assertEqual(audit(self.marker, [self.sim])['status'], 'not_run')

    def test_cli_returns_nonzero_and_writes_metadata_report(self):
        self.make_report('xDriveIOS-incident.ips', '{}')
        destination = self.root / 'audit.json'
        rc = main(['--marker', str(self.marker), '--output', str(destination), str(self.sim)])
        self.assertEqual(rc, 1)
        self.assertEqual(json.loads(destination.read_text())['app_crash_report_count'], 1)

    def test_duplicate_report_names_fail_without_double_count(self):
        self.make_report('xDriveIOS-incident.ips', '{}', root=self.host)
        self.make_report('xDriveIOS-incident.ips', '{}', root=self.sim)
        report = audit(self.marker, [self.host, self.sim])
        self.assertEqual(report['app_crash_report_count'], 1)
        self.assertEqual(report['status'], 'fail')


if __name__ == '__main__':
    unittest.main()
