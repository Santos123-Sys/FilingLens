"""Bounded official-source acquisition. No model/user-selected network addresses."""
import asyncio
import base64
import csv
import hashlib
import io
import os
import re
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field, model_validator


class AcquisitionRequest(BaseModel):
    jurisdiction: str = Field(pattern=r"^(us|br)$")
    registryId: str = Field(pattern=r"^\d{10}$|^\d{14}$")
    startYear: int = Field(ge=2000, le=2200)
    endYear: int = Field(ge=2000, le=2200)
    existing: list[str] = Field(default_factory=list, max_length=120)

    @model_validator(mode="after")
    def scope(self):
        if len(self.registryId) != (10 if self.jurisdiction == "us" else 14) or not 0 <= self.endYear-self.startYear <= 10:
            raise ValueError("invalid_scope")
        return self


_lock = asyncio.Lock()
_last_request = 0.0


async def get_bytes(client, url, limit=8_000_000):
    global _last_request
    u = urlparse(url)
    if u.scheme != "https" or u.username or u.password or u.port or u.hostname not in {"data.sec.gov", "www.sec.gov", "dados.cvm.gov.br", "www.rad.cvm.gov.br", "www.apple.com"}:
        raise ValueError("source_not_allowed")
    if u.hostname=='www.apple.com' and url!='https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf':raise ValueError('issuer_source_not_allowed')
    async with _lock:
        await asyncio.sleep(max(0, 0.25-(time.monotonic()-_last_request)))
        _last_request = time.monotonic()
        async with client.stream("GET", url, follow_redirects=False) as res:
            res.raise_for_status()
            out = bytearray()
            async for part in res.aiter_bytes():
                out.extend(part)
                if len(out) > limit:
                    raise ValueError("source_size_limit")
            return bytes(out)


def document(raw, name, year, form, url, period=None, provenance='regulator_download'):
    if len(raw) > 8_000_000:
        raise ValueError("document_size_limit")
    return {"base64": base64.b64encode(raw).decode(), "name": name, "year": year,
            "form": form, "sourceUrl": url, "periodEnd": period,
            "provenance": provenance, "sha256": hashlib.sha256(raw).hexdigest()}


def cvm_company_rows(raw, cnpj, year, form, url):
    """Retain all versions/columns, including unit and period headers. Never claim a CSV is a PDF."""
    output = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if len(infos) > 200 or sum(i.file_size for i in infos) > 450_000_000:
            raise ValueError("archive_expansion_limit")
        for info in infos:
            if not info.filename.endswith(".csv") or info.file_size > 160_000_000:
                continue
            with archive.open(info) as stream:
                reader = csv.DictReader(io.TextIOWrapper(stream, encoding="latin1"), delimiter=";")
                selected = io.StringIO()
                writer = csv.DictWriter(selected, fieldnames=reader.fieldnames or [], delimiter=";")
                writer.writeheader()
                found = 0
                for row in reader:
                    identity = row.get("CNPJ_CIA") or row.get("CNPJ_Companhia") or row.get("CNPJ") or ""
                    if re.sub(r"\D", "", identity) == cnpj:
                        writer.writerow(row)
                        found += 1
                        if selected.tell() > 2_000_000:
                            raise ValueError("company_rows_limit")
                if found:
                    output.append((info.filename.rsplit("/",1)[-1], selected.getvalue()))
    if not output:
        return None
    text = f"CVM company-filtered derivative. Original archive SHA256: {hashlib.sha256(raw).hexdigest()}\nCNPJ: {cnpj}\nSource archive: {url}\nAll matching versions retained; this is not the complete filing PDF.\n\n"+"\n\n".join(f"SOURCE TABLE: {name}\n{content}" for name, content in output)
    return document(text.encode(), f"{form}-{year}-CVM-company-tables.txt", year, form, url)


async def acquire(req: AcquisitionRequest, fetch=get_bytes):
    docs, gaps = [], []
    started = time.monotonic()
    contact = os.getenv("SEC_CONTACT_EMAIL", "")
    ua = os.getenv("SEC_USER_AGENT") or (f"FilingLens {contact}" if contact else "")
    async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5), headers={"User-Agent": ua or "FilingLens public research"}) as client:
        if req.jurisdiction == "us":
            if not ua or "@" not in ua:
                return {"documents": [], "gaps": ["SEC contact identity is not configured."]}
            try:
                import json
                body = json.loads(await fetch(client, f"https://data.sec.gov/submissions/CIK{req.registryId}.json"))
                recent = body.get("filings", {}).get("recent", {})
                tables = [recent]
                for older in body.get("filings", {}).get("files", [])[:3]:
                    name = older.get("name", "")
                    if re.fullmatch(r"CIK\d{10}-submissions-\d+\.json", name) and str(req.startYear) <= older.get("filingTo", "") and str(req.endYear+1) >= older.get("filingFrom", ""):
                        tables.append(json.loads(await fetch(client, "https://data.sec.gov/submissions/"+name)))
                for table in tables:
                    for i, form in enumerate(table.get("form", [])):
                        if form not in {"10-K","10-Q","8-K","20-F","6-K","10-K/A","10-Q/A"}:
                            continue
                        accession = table.get("accessionNumber", [])[i]
                        primary = table.get("primaryDocument", [])[i]
                        period = table.get("reportDate", [])[i] or table.get("filingDate", [])[i]
                        year = int(period[:4])
                        if not req.startYear <= year <= req.endYear or not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or not re.fullmatch(r"[A-Za-z0-9_.-]+", primary):
                            continue
                        url = f"https://www.sec.gov/Archives/edgar/data/{int(req.registryId)}/{accession.replace('-','')}/{primary}"
                        if url in req.existing: continue
                        if len(docs)>=6 or time.monotonic()-started>55: break
                        try:
                            docs.append(document(await fetch(client,url), primary,year,form,url,period))
                        except Exception as exc:
                            gaps.append(f"{form} {year}: {type(exc).__name__}; source remains unresolved.")
                            if isinstance(exc,httpx.HTTPStatusError) and exc.response.status_code in {403,429}: break
            except Exception as exc:
                gaps.append(f"SEC discovery unavailable: {type(exc).__name__}. No access bypass attempted.")
        else:
            for year in range(req.endYear,req.startYear-1,-1):
                for form in ("FRE","ITR","DFP","IPE"):
                    url=f"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/{form}/DADOS/{form.lower()}_cia_aberta_{year}.zip"
                    if url in req.existing: continue
                    if len(docs)>=6 or time.monotonic()-started>55: break
                    try:
                        raw=await fetch(client,url,40_000_000)
                        doc=await asyncio.to_thread(cvm_company_rows,raw,req.registryId,year,form,url)
                        if doc:
                            docs.append(doc)
                            if form == 'IPE':
                                text=base64.b64decode(doc['base64']).decode()
                                links=list(dict.fromkeys(re.findall(r'https://www\.rad\.cvm\.gov\.br/[^\s;"<>]+',text)))
                                for link in links[:2]:
                                    if len(docs)>=6 or time.monotonic()-started>55:break
                                    if link in req.existing:continue
                                    try:
                                        content=await fetch(client,link)
                                        suffix='pdf' if content.startswith(b'%PDF-') else 'html'
                                        docs.append(document(content,f'CVM-release-{hashlib.sha256(link.encode()).hexdigest()[:12]}.{suffix}',year,'Earnings release',link))
                                    except Exception as exc:gaps.append(f'IPE linked document: {type(exc).__name__}.')
                        else: gaps.append(f"{form} {year}: no matching CNPJ rows.")
                    except Exception as exc:
                        gaps.append(f"{form} {year}: {type(exc).__name__}; source remains unresolved.")
        if req.jurisdiction=='us' and req.registryId=='0000320193' and req.startYear<=2025<=req.endYear and not docs:
            url='https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf'
            if url not in req.existing:
                try:docs.append(document(await fetch(client,url),'Apple-FY2025-issuer-statements.pdf',2025,'Earnings release',url,'2025-09-27','issuer_download'))
                except Exception as exc:gaps.append(f'Issuer fallback unavailable: {type(exc).__name__}.')
    retained=[];total=0
    for doc in docs:
        total+=len(doc['base64'])
        if total>25_000_000:gaps.append('Response byte budget reached; remaining files require another acquisition run.');break
        retained.append(doc)
    return {"documents":retained,"gaps":gaps[:20]+["Acquisition is bounded to six documents per run. Repeat to fill remaining coverage. CVM tables and IPE metadata are not full narrative filings. CVM folder years identify dataset delivery years; verify reporting periods within the evidence. No complete-coverage assertion is made."],"retrievedAt":datetime.now(timezone.utc).isoformat()}
