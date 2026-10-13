# Synthetic Resume Fixture

`resume.pdf` contains two pages of invented candidate information, with no real
personal data. Tests parse this file using the installed `pdf-parse` dependency;
they do not replace the PDF engine with a fake implementation.

`blank-resume.pdf` is a valid one-page PDF with no text. It tests that generated
page labels are not treated as candidate evidence and that blank imports do not
contact AI or change an existing profile.

To regenerate both files, install ReportLab in a Python environment and run
`python scripts/fixtures/create-resume-pdf.py` from the repository root. The
generator uses invariant metadata so its output is reproducible. Python and
ReportLab are only needed for regeneration, not for the application or test run.

`resume.docx` is a minimal Open XML package with invented candidate text. Tests
extract it through Mammoth's library API; the separate Mammoth command-line tool
is intentionally excluded from dependency installation because Hire.AI does not
use it.

To regenerate it with Python's standard library, run
`python scripts/fixtures/create-resume-docx.py` from the repository root. PDFs and
DOCX fixtures are marked binary in `.gitattributes` for consistent Windows and
Linux checkouts.
