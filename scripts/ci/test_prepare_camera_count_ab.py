import unittest
from prepare_camera_count_ab import prepare


class CameraCountABTests(unittest.TestCase):
    before = 'func (s *Server) queryMediaItemRange() {\n\tcount()\n}'
    after = 'func (s *Server) queryMediaItemRange() {\n\tgroups()\n}'

    def test_keeps_current_dtos_and_unrelated_code_in_both_arms(self):
        candidate = 'type NewDTO struct { ID int }\n' + self.after + '\nfunc untouched() {}\n'
        self.assertEqual(prepare(candidate, self.before, self.after),
                         candidate.replace(self.after, self.before))

    def test_rejects_drift_and_missing_or_duplicate_query(self):
        for candidate in (self.after.replace('groups()', 'other()'), '', self.after + '\n' + self.after):
            with self.assertRaises(ValueError):
                prepare(candidate, self.before, self.after)

    def test_rejects_optimized_before(self):
        with self.assertRaises(ValueError):
            prepare(self.after, self.after, self.after)
