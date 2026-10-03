"""Regenerate the synthetic, two-page PDF used by resume extraction tests."""

from pathlib import Path

from reportlab.pdfgen.canvas import Canvas


target = Path(__file__).resolve().parents[2] / "server/testFixtures/resume.pdf"
target.parent.mkdir(parents=True, exist_ok=True)
pdf = Canvas(str(target), invariant=1, pageCompression=0)
pdf.setTitle("Synthetic resume extraction fixture")
pdf.setAuthor("Hire.AI test suite")
pdf.drawString(72, 760, "Alex Example")
pdf.drawString(72, 730, "Skills: TypeScript, React, PostgreSQL")
pdf.showPage()
pdf.drawString(72, 760, "Experience: Software Engineer at Example Company")
pdf.drawString(72, 730, "Education: Computer Science")
pdf.save()

blank = Canvas(str(target.with_name("blank-resume.pdf")), invariant=1, pageCompression=0)
blank.setTitle("Synthetic blank resume fixture")
blank.setAuthor("Hire.AI test suite")
blank.showPage()
blank.save()
