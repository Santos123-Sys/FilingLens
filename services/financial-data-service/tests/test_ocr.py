import base64
import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from pypdf import PdfWriter

from app.ocr import OCRRequest, extract_ocr


def sample_pdf(pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def test_ocr_retains_original_hash_and_bounds_subprocess(monkeypatch):
    raw = sample_pdf()

    def run(args, **kwargs):
        assert args[:3] == ['ocrmypdf', '--language', 'eng+por']
        assert kwargs['timeout'] == 75 and kwargs['capture_output'] is True
        Path(args[args.index('--sidecar') + 1]).write_text('Visible extracted text. ' * 12)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr('app.ocr.subprocess.run', run)
    result = extract_ocr(OCRRequest(base64=base64.b64encode(raw).decode()))
    import hashlib
    assert result['sha256'] == hashlib.sha256(raw).hexdigest()
    assert result['pageCount'] == 1 and 'ocrmypdf' in result['parser']


def test_ocr_rejects_invalid_or_oversized_page_count_without_invoking_engine(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('OCR subprocess must not start')
    monkeypatch.setattr('app.ocr.subprocess.run', forbidden)
    with pytest.raises(ValueError, match='invalid_pdf'):
        extract_ocr(OCRRequest(base64=base64.b64encode(b'not a PDF').decode()))
    with pytest.raises(ValueError, match='ocr_page_budget'):
        extract_ocr(OCRRequest(base64=base64.b64encode(sample_pdf(31)).decode()))
