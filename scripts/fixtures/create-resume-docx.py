from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


OUTPUT = Path("server/testFixtures/resume.docx")
OVERSIZED_OUTPUT = Path("server/testFixtures/oversized-resume.docx")
MISREPORTED_OUTPUT = Path("server/testFixtures/misreported-resume.docx")

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

PACKAGE_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Alex Example</w:t></w:r></w:p>
    <w:p><w:r><w:t>Skills: TypeScript, React</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>"""


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", CONTENT_TYPES)
    docx.writestr("_rels/.rels", PACKAGE_RELS)
    docx.writestr("word/document.xml", DOCUMENT)

with ZipFile(OVERSIZED_OUTPUT, "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", CONTENT_TYPES)
    docx.writestr("_rels/.rels", PACKAGE_RELS)
    docx.writestr("word/document.xml", "x" * (20 * 1024 * 1024 + 1))

with ZipFile(MISREPORTED_OUTPUT, "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", CONTENT_TYPES)
    docx.writestr("_rels/.rels", PACKAGE_RELS)
    docx.writestr("word/document.xml", "x" * (20 * 1024 * 1024 + 1))

archive = bytearray(MISREPORTED_OUTPUT.read_bytes())
document_name = b"word/document.xml"
local_name_offset = archive.find(document_name)
central_name_offset = archive.find(document_name, local_name_offset + len(document_name))
if local_name_offset < 30 or central_name_offset < 46:
    raise ValueError("Unable to locate the synthetic DOCX document entry")
archive[local_name_offset - 30 + 22:local_name_offset - 30 + 26] = b"\x00" * 4
archive[central_name_offset - 46 + 24:central_name_offset - 46 + 28] = b"\x00" * 4
MISREPORTED_OUTPUT.write_bytes(archive)
