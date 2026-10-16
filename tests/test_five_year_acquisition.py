import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("five_year",Path(__file__).resolve().parents[1]/"ops/acquire-five-year-cohort.py")
acquire=importlib.util.module_from_spec(spec);spec.loader.exec_module(acquire)


class DuplicateVintageTests(unittest.TestCase):
    def row(self):return {"id":"CVM-1-2023-v1","sourceRowSha256":"a"*64,"sourceSha256":"b"*64,"publishedOn":"2024-03-01","receipt":{"VERSAO":"1"},"value":100}
    def test_identical_rows_collapsed_with_count_and_without_mutating_source(self):
        row=self.row();result=acquire.collapse_identical_vintages([row,dict(row)])
        self.assertEqual(len(result),1);self.assertEqual(result[0]["sourceDuplicateCount"],2)
        self.assertNotIn("sourceDuplicateCount",row)
    def test_conflicting_vintages_stop_acquisition_instead_of_selecting_last(self):
        with self.assertRaisesRegex(ValueError,"Conflicting"):
            acquire.collapse_identical_vintages([self.row(),{**self.row(),"sourceRowSha256":"c"*64,"value":200}])


if __name__=="__main__":unittest.main()
