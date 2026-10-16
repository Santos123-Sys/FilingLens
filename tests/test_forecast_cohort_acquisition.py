"""Offline regression: revised cells must never borrow the original receipt."""
import csv
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("acquire", Path(__file__).resolve().parents[1] / "ops/acquire-forecast-cohort.py")
acquire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquire)


class AcquisitionTest(unittest.TestCase):
    def archive(self, exact=True):
        cells = {"CD_CVM":"000123","DT_REFER":"2018-12-31","VERSAO":"2","DT_INI_EXERC":"2018-01-01","DT_FIM_EXERC":"2018-12-31","CD_CONTA":"3.01","ORDEM_EXERC":"ÚLTIMO","MOEDA":"REAL","ESCALA_MOEDA":"MIL","VL_CONTA":"123456","DS_CONTA":"Receita","DENOM_CIA":"Synthetic"}
        receipt = {"CD_CVM":"000123","DT_REFER":"2018-12-31","VERSAO":"1","DT_RECEB":"2019-03-01","ID_DOC":"1","LINK_DOC":"http://www.rad.cvm.gov.br/example"}
        receipts = [receipt]
        if exact:
            receipts.append({**receipt,"VERSAO":"2","DT_RECEB":"2021-04-01","ID_DOC":"2"})
        output = io.BytesIO()
        with zipfile.ZipFile(output,"w") as archive:
            for name, rows in [("dfp_cia_aberta_2018.csv",receipts),("dfp_cia_aberta_DRE_con_2018.csv",[cells,{**cells,"ORDEM_EXERC":"PENÚLTIMO","VL_CONTA":"999999"}])]:
                text = io.StringIO(); writer = csv.DictWriter(text,fieldnames=list(rows[0]),delimiter=";")
                writer.writeheader(); writer.writerows(rows); archive.writestr(name,text.getvalue().encode("latin1"))
        return output.getvalue()

    def test_exact_receipt_and_current_period_only(self):
        rows, _ = acquire.extract_year(self.archive(),2018)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["publishedOn"],"2021-04-01")
        self.assertEqual(rows[0]["value"],123.456)
        self.assertEqual(rows[0]["documentId"],"2")

    def test_no_exact_version_receipt_means_exclusion(self):
        rows, manifest = acquire.extract_year(self.archive(False),2018)
        self.assertEqual(rows,[])
        self.assertEqual(manifest["exclusions"]["missing_or_ambiguous_exact_version_receipt"],1)


if __name__ == "__main__":
    unittest.main()
