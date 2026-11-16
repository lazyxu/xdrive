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


    def test_missing_all_crash_report_roots_cannot_pass(self):
        result = audit(self.marker, [self.root / 'missing'])
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['available_report_roots'], 0)
        self.assertIn('no_crash_report_roots_available', result['scan_errors'])

    def test_optional_missing_directory_does_not_hide_real_app_crash(self):
        self.make_report('xDriveIOS-incident.ips', '{}', root=self.host)
        result = audit(self.marker, [self.root / 'missing', self.host])
        self.assertEqual(result['status'], 'fail')
        self.assertEqual(result['available_report_roots'], 1)
        self.assertEqual(result['app_crash_report_count'], 1)

    def test_cli_fails_closed_when_all_report_directories_are_missing(self):
        destination = self.root / 'audit.json'
        rc = main(['--marker', str(self.marker), '--output', str(destination),
                   str(self.root / 'missing')])
        self.assertEqual(rc, 1)
        report = json.loads(destination.read_text())
        self.assertEqual(report['status'], 'error')
        self.assertIn('no_crash_report_roots_available', report['scan_errors'])


    def make_log(self, content, *, before=False):
        path = self.root / 'xcodebuild.log'
        path.write_text(content, encoding='utf-8')
        ns = self.start - 1_000_000_000 if before else self.start + 1_000_000_000
        os.utime(path, ns=(ns, ns))
        return path

    def test_real_xctest_lost_target_app_without_ips_is_inconclusive_not_pass(self):
        # Exact native failure shape reproduced in a MapKit PhotoKit-revoke
        # Simulator run: XCUI lost the application PID; independent .ips audit
        # found only unrelated reports. Never call that a clean native pass.
        log = self.make_log(
            "/Users/runner/work/xdrive/xdrive/ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift:193: error: -[xDriveIOSNavigationUITests.XDriveIOSMapNavigationRuntimeUITests testZP0ExternallyRevokedPhotosRejectOldMapAndRecover] : Failed to get matching snapshots: Lost connection to the application (pid 51223). (Underlying Error: Couldn’t communicate with a helper application.)" + '\n'
            'Checking for crash reports corresponding to unexpected termination '
            'of com.lazyxu.xdrive.ios\n'
        )
        result = audit(self.marker, [self.sim], xcodebuild_log=log)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['app_crash_report_count'], 0)
        self.assertEqual(result['app_connection_lost_count'], 1)
        self.assertIn('xctest_app_disconnected_without_crash_report', result['scan_errors'])

    def test_xctest_disconnection_with_real_app_ips_remains_confirmed_failure(self):
        log = self.make_log("/Users/runner/work/xdrive/xdrive/ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift:193: error: -[xDriveIOSNavigationUITests.XDriveIOSMapNavigationRuntimeUITests testZP0ExternallyRevokedPhotosRejectOldMapAndRecover] : Failed to get matching snapshots: Lost connection to the application (pid 51223). (Underlying Error: Couldn’t communicate with a helper application.)" + '\n')
        self.make_report('xDriveIOS-incident.ips', '{}')
        result = audit(self.marker, [self.sim], xcodebuild_log=log)
        self.assertEqual(result['status'], 'fail')
        self.assertEqual(result['app_connection_lost_count'], 1)
        self.assertEqual(result['app_crash_report_count'], 1)

    def test_unrelated_system_app_xctest_disconnection_not_xdriveios_crash(self):
        log = self.make_log(
            '/tmp/OtherUITests.swift:44: error: -[OtherUITests.OtherTests '
            'testSomething] : Lost connection to the application (pid 42)\n'
        )
        result = audit(self.marker, [self.sim], xcodebuild_log=log)
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(result['app_connection_lost_count'], 0)

    def test_plain_navigation_assertion_is_not_a_process_disconnection(self):
        log = self.make_log(
            '/tmp/XDriveIOSMapNavigationRuntimeUITests.swift:406: error: '
            '-[xDriveIOSNavigationUITests.XDriveIOSMapNavigationRuntimeUITests '
            'testMapCameraLayoutAndUnverifiedGestureNeverClosesTheApp] : '
            'XCTAssertTrue failed\n'
        )
        self.assertEqual(
            audit(self.marker, [self.sim], xcodebuild_log=log)['status'], 'pass'
        )

    def test_arbitrary_log_line_containing_loss_words_is_not_runtime_evidence(self):
        log = self.make_log(
            'print("Lost connection to the application (pid 42)")\n'
            'Test Case has failed but no process termination is known\n'
        )
        self.assertEqual(
            audit(self.marker, [self.sim], xcodebuild_log=log)['status'], 'pass'
        )

    def test_required_log_missing_is_inconclusive_not_false_pass(self):
        result = audit(
            self.marker, [self.sim], xcodebuild_log=self.root / 'missing.log'
        )
        self.assertEqual(result['status'], 'error')
        self.assertIn('xcodebuild_log_missing', result['scan_errors'])

    def test_log_predating_test_marker_is_not_current_process_evidence(self):
        log = self.make_log("/Users/runner/work/xdrive/xdrive/ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift:193: error: -[xDriveIOSNavigationUITests.XDriveIOSMapNavigationRuntimeUITests testZP0ExternallyRevokedPhotosRejectOldMapAndRecover] : Failed to get matching snapshots: Lost connection to the application (pid 51223). (Underlying Error: Couldn’t communicate with a helper application.)", before=True)
        result = audit(self.marker, [self.sim], xcodebuild_log=log)
        self.assertEqual(result['status'], 'error')
        self.assertIn('xcodebuild_log_predates_test_marker', result['scan_errors'])
        self.assertEqual(result['app_connection_lost_count'], 0)

    def test_cli_exit_is_nonzero_for_lost_process_without_ips(self):
        log = self.make_log("/Users/runner/work/xdrive/xdrive/ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift:193: error: -[xDriveIOSNavigationUITests.XDriveIOSMapNavigationRuntimeUITests testZP0ExternallyRevokedPhotosRejectOldMapAndRecover] : Failed to get matching snapshots: Lost connection to the application (pid 51223). (Underlying Error: Couldn’t communicate with a helper application.)" + '\n')
        destination = self.root / 'audit-lost-app.json'
        rc = main([
            '--marker', str(self.marker),
            '--output', str(destination),
            '--xcodebuild-log', str(log), str(self.sim)
        ])
        self.assertEqual(rc, 1)
        result = json.loads(destination.read_text())
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['app_connection_lost_count'], 1)


if __name__ == '__main__':
    unittest.main()
