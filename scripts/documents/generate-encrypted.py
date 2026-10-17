"""Optional fixture regeneration: Python 3 with pypdf (not a runtime dependency)."""
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject
root = Path(__file__).resolve().parents[2] / 'src/features/documents/fixtures/files'
writer = PdfWriter()
writer.append(PdfReader(root / 'municipal.pdf'))
# Fixed fictional ID and RC4 are intentional, solely for reproducible rejection tests.
writer._ID = ArrayObject([ByteStringObject(b'civix-synthetic!'), ByteStringObject(b'civix-synthetic!')])
writer.encrypt('fictional-password', algorithm='RC4-128')
writer.write(root / 'encrypted.pdf')
