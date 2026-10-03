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

The PDFs are marked binary in `.gitattributes` to preserve PDF byte offsets across
Windows and Linux checkouts.
