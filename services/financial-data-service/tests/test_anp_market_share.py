import io
import zipfile

from app.providers.anp import calculate_market_share_from_zip


def _dataset_zip() -> bytes:
    csv = """ANO;MÊS;RAZÃO SOCIAL DISTRIBUIDOR;CNPJ DISTRIBUIDOR;PRODUTO;VOLUME VENDIDO (m3)
2026;1;VIBRA ENERGIA S.A.;34274233000102;Gasolina C;30
2026;1;VIBRA ENERGIA S.A.;34274233000102;Diesel B;20
2026;1;OUTRA DISTRIBUIDORA S.A.;11111111000100;Gasolina C;70
2026;1;OUTRA DISTRIBUIDORA S.A.;11111111000100;Diesel B;80
2025;12;VIBRA ENERGIA S.A.;34274233000102;Gasolina C;25
2025;12;OUTRA DISTRIBUIDORA S.A.;11111111000100;Gasolina C;75
"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("vendas_distribuidores.csv", csv.encode("utf-8"))
    return buf.getvalue()


def test_anp_market_share_uses_same_period_product_and_denominator():
    result = calculate_market_share_from_zip(
        _dataset_zip(),
        "Vibra Energia S.A.",
        "34.274.233/0001-02",
        4,
    )
    assert result.status == "complete"
    assert result.period == "2026 YTD through M01"
    assert result.matchedCompany == "VIBRA ENERGIA S.A."
    overall = result.metrics[0]
    assert overall.valuePercent == 25.0
    assert overall.numerator == 50.0
    assert overall.denominator == 200.0
    product = {metric.productScope: metric for metric in result.metrics[1:]}
    assert product["Gasolina C"].valuePercent == 30.0
    assert product["Diesel B"].valuePercent == 20.0
    assert all(metric.provider == "ANP SIMP" for metric in result.metrics)
