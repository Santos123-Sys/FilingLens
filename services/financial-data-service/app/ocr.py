"""Bounded, request-local OCR for image-only PDF evidence."""
import base64
import hashlib
import io
import subprocess
import tempfile
from pathlib import Path

from pydantic import BaseModel, Field
from pypdf import PdfReader
from pypdf.errors import PdfReadError


class OCRRequest(BaseModel):
    base64: str = Field(min_length=1, max_length=10_666_672)


def extract_ocr(req: OCRRequest):
    raw = base64.b64decode(req.base64, validate=True)
    if not raw.startswith(b'%PDF-') or len(raw) > 8_000_000:
        raise ValueError('invalid_pdf')
    pages = len(PdfReader(io.BytesIO(raw), strict=True).pages)
    if not 1 <= pages <= 30:
        raise ValueError('ocr_page_budget')
    with tempfile.TemporaryDirectory(prefix='filinglens-ocr-') as directory:
        source = Path(directory) / 'source.pdf'
        sidecar = Path(directory) / 'text.txt'
        source.write_bytes(raw)
        command = ['ocrmypdf', '--language', 'eng+por', '--output-type', 'none',
                   '--sidecar', str(sidecar), '--jobs', '1', '--tesseract-timeout', '12',
                   '--skip-big', '12',
                   '--optimize', '0', str(source), '-']
        # No shell, no user-controlled arguments, no subprocess output in responses/logs.
        result = subprocess.run(command, capture_output=True, timeout=75, check=False,
                                cwd=directory, env={'PATH': '/usr/local/bin:/usr/bin:/bin',
                                                    'HOME': directory, 'TMPDIR': directory,
                                                    'LANG': 'C.UTF-8'})
        if result.returncode != 0 or not sidecar.exists():
            raise ValueError('ocr_failed')
        if sidecar.stat().st_size > 2_000_000:
            raise ValueError('ocr_text_budget')
        text = sidecar.read_text(encoding='utf-8').replace('\r\n', '\n').strip()
        if len(text) < 100 or '\x00' in text:
            raise ValueError('ocr_insufficient_text')
    return {'text': text, 'parser': 'ocrmypdf-17.13.0-tesseract-eng-por-v1',
            'sha256': hashlib.sha256(raw).hexdigest(), 'pageCount': pages}
