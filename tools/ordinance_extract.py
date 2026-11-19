#!/usr/bin/env python3
"""Extract a fare table from an ordinance file (DOCX or PDF).

Prints one JSON object:
  {kind, pages, rows:[{row, from, to, regular, discounted, remark}], warning}

DOCX: real Word tables are read from word/document.xml.
PDF: a text layer is read with PyMuPDF. A scanned PDF has no text layer, and
this tool says so instead of guessing — OCR is a separate, reviewed step.
"""
import json
import os
import re
import sys
import zipfile

ROW_RE = re.compile(r"^\s*(\d{1,3})\s*[.)]?\s+(.*?)\s{2,}(.*?)\s{2,}₱?\s*([\d,]+(?:\.\d+)?)")
OCR_ROW_RE = re.compile(
    r"^(POB|CCLTT|POS|POBLACION|TERMINAL)\s*\|?\s*(.+?)\s+"
    r"(\d{1,3}(?:[.,]\d{2})?)\s+(\d{1,3}(?:[.,]\d{2})?)$",
    re.IGNORECASE,
)


def money(text):
    if text is None:
        return None
    cleaned = re.sub(r"[^0-9.]", "", str(text))
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return value if value < 100000 else None


def cell_texts(tc):
    return " ".join(
        re.sub(r"<[^>]+>", "", chunk).strip()
        for chunk in re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", tc, re.S)
    ).strip()


def docx_tables(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if "word/document.xml" not in names:
            raise ValueError("not a Word document")
        xml = archive.read("word/document.xml").decode("utf-8", "ignore")
        media = len([n for n in names if n.startswith("word/media/")])
    tables = []
    for tbl in re.findall(r"<w:tbl>.*?</w:tbl>", xml, re.S):
        rows = []
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S):
            cells = [
                cell_texts(tc)
                for tc in re.findall(r"<w:tc[ >].*?</w:tc>", tr, re.S)
            ]
            rows.append(cells)
        tables.append(rows)
    return tables, media


def parse_tables(tables):
    rows = []
    for table in tables:
        header = None
        for index, cells in enumerate(table):
            lowered = [c.lower() for c in cells]
            if any("from" in c for c in lowered) and any(
                "fare" in c or "rate" in c for c in lowered
            ):
                header = {"index": index, "cells": lowered}
                break
        if header is None:
            continue

        def column(*needles, default=None):
            for position, name in enumerate(header["cells"]):
                if all(needle in name for needle in needles):
                    return position
            return default

        col_from = column("from")
        col_to = column("to")
        col_regular = column("regular")
        col_discounted = column("discounted")
        col_remark = column("remark")
        if col_from is None or col_to is None or col_regular is None:
            continue

        for cells in table[header["index"] + 1 :]:
            if len(cells) <= max(col_from, col_to, col_regular):
                continue
            raw_row = cells[0].strip() if cells else ""
            if not re.match(r"^\d{1,3}$", raw_row):
                continue
            regular = money(cells[col_regular])
            if regular is None:
                continue
            rows.append(
                {
                    "row": int(raw_row),
                    "from": cells[col_from].strip(),
                    "to": cells[col_to].strip(),
                    "regular": regular,
                    "discounted": money(cells[col_discounted]) if col_discounted is not None else None,
                    "remark": cells[col_remark].strip() if col_remark is not None and col_remark < len(cells) else "",
                }
            )
    return rows


def find_tesseract():
    import shutil
    candidates = [
        os.environ.get("TESSERACT_CMD"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        shutil.which("tesseract"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def ocr_pdf(path):
    """Render pages and read them with Tesseract.

    Returns page text, page size and a small JPEG of each page (base64) so the
    admin can check the reading against the paper. It deliberately does not
    pretend to rebuild the fare table: a scanned matrix column layout is too
    easy to misread for an automatic amount.
    """
    import base64
    import pymupdf
    import subprocess
    import tempfile

    binary = find_tesseract()
    document = pymupdf.open(path)
    folder = tempfile.mkdtemp(prefix="farefair-ocr-")
    pages = []
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(dpi=400)
        image_path = os.path.join(folder, f"page-{index + 1}.png")
        pixmap.save(image_path)
        text = ""
        if binary:
            result = subprocess.run(
                [binary, image_path, "stdout", "--psm", "4"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
            )
            text = result.stdout or ""

        preview = page.get_pixmap(dpi=110)
        preview_path = os.path.join(folder, f"preview-{index + 1}.jpg")
        preview.save(preview_path, jpg_quality=55)
        with open(preview_path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")

        pages.append(
            {
                "page": index + 1,
                "text": text.strip(),
                "width": pixmap.width,
                "height": pixmap.height,
                "image": encoded,
            }
        )
    return pages


def candidate_rows(pages):
    """Rows read from OCR text, kept as candidates for a human to confirm."""
    rows = []
    number = 0
    for page in pages:
        for line in page["text"].splitlines():
            match = OCR_ROW_RE.match(line.strip())
            if not match:
                continue
            destination = match.group(2).strip(" |")
            if not destination or "DESTINATION" in destination.upper():
                continue
            number += 1
            rows.append(
                {
                    "row": number,
                    "from": match.group(1).upper(),
                    "to": destination,
                    "regular": money(match.group(3)),
                    "discounted": money(match.group(4)),
                    "remark": "",
                    "page": page["page"],
                }
            )
    return rows


def pdf_rows(path):
    import pymupdf

    document = pymupdf.open(path)
    pages = len(document)
    text = "\n".join(page.get_text() for page in document)
    chars = len(text.strip())
    if chars < 40:
        if find_tesseract():
            ocr_pages = ocr_pdf(path)
            if any(page["text"] for page in ocr_pages):
                candidates = candidate_rows(ocr_pages)
                return {
                    "kind": "pdf_ocr",
                    "pages": pages,
                    "rows": candidates,
                    "ocr_pages": ocr_pages,
                    "ocr_chars": sum(len(page["text"]) for page in ocr_pages),
                    "warning": (
                        f"OCR read {len(candidates)} row candidate(s) from "
                        f"{pages} scanned page(s). Confirm the amounts against "
                        "the page images before applying."
                    ),
                }
        return {
            "kind": "scan",
            "pages": pages,
            "rows": [],
            "warning": (
                "This PDF has no text layer: it is a scan. Install Tesseract or "
                "upload the typed document."
            ),
        }
    rows = []
    for line in text.splitlines():
        match = ROW_RE.match(line.replace("\u00a0", " "))
        if not match:
            continue
        rows.append(
            {
                "row": int(match.group(1)),
                "from": match.group(2).strip(),
                "to": match.group(3).strip(),
                "regular": money(match.group(4)),
                "discounted": None,
                "remark": "",
            }
        )
    warning = "" if rows else "Text was found but no fare rows could be parsed from its layout."
    return {"kind": "pdf_text", "pages": pages, "rows": rows, "warning": warning}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: ordinance_extract.py <file>"}))
        return 1
    path = sys.argv[1]
    extension = os.path.splitext(path)[1].lower()
    try:
        if extension == ".docx":
            tables, media = docx_tables(path)
            rows = parse_tables(tables)
            warning = ""
            if not rows and media:
                warning = (
                    f"This document contains {media} image(s) and no readable fare "
                    "table; it looks like a scan pasted into Word."
                )
            elif not rows:
                warning = "No fare table was recognised in this document."
            result = {
                "kind": "docx",
                "pages": None,
                "tables": len(tables),
                "media": media,
                "rows": rows,
                "warning": warning,
            }
        elif extension == ".pdf":
            result = pdf_rows(path)
        else:
            result = {
                "kind": "unknown",
                "pages": None,
                "rows": [],
                "warning": "Only .docx and .pdf are accepted.",
            }
    except Exception as error:  # noqa: BLE001
        result = {"kind": "error", "pages": None, "rows": [], "warning": str(error)}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
