/** Minimal fixture writer only; production parsing always uses PDF.js. */
export function fixturePdf(
  texts: string[],
  image?: { bytes: Buffer; width: number; height: number },
  unicode?: string,
  brokenPage?: number,
): Buffer {
  const objects: Buffer[] = [];
  const add = (value: string | Buffer) => {
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    return objects.length;
  };
  const stream = (dictionary: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from("\nendstream"),
    ]);
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = texts.map((_, i) => 4 + i * 2);
  add(
    `<< /Type /Pages /Count ${texts.length} /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] >>`,
  );
  const extraId = 4 + texts.length * 2;
  add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${unicode ? `/ToUnicode ${extraId + 1} 0 R` : ""} >>`,
  );
  for (const [i, text] of texts.entries()) {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${image ? `/XObject << /Im1 ${extraId} 0 R >>` : ""} >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const escaped = text.replace(/[\\()]/g, "\\$&");
    const body =
      !image && !text
        ? ""
        : image
          ? `q 580 0 0 290 16 480 cm /Im1 Do Q\n${unicode ? "BT /F1 12 Tf 3 Tr 20 750 Td <" + [...unicode].map((_, n) => (n + 33).toString(16).padStart(2, "0")).join("") + "> Tj ET" : ""}`
          : `BT /F1 12 Tf 16 TL 20 750 Td ${escaped
              .match(/.{1,75}(?: |$)|.{1,75}/g)
              ?.map((line) => `(${line}) Tj T*`)
              .join(" ")} ET`;
    add(
      stream(
        brokenPage === i + 1 ? "/Filter /FlateDecode" : "",
        Buffer.from(body),
      ),
    );
  }
  if (image)
    add(
      stream(
        `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        image.bytes,
      ),
    );
  if (unicode) {
    const mapping = [...unicode]
      .map(
        (char, n) =>
          `<${(n + 33).toString(16).padStart(2, "0")}> <${Buffer.from(char, "utf16le").swap16().toString("hex")}>`,
      )
      .join("\n");
    add(
      stream(
        "",
        Buffer.from(
          `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${[...unicode].length} beginbfchar\n${mapping}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`,
        ),
      ),
    );
  }
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(chunks.reduce((n, b) => n + b.length, 0));
    chunks.push(
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    );
  }
  const start = chunks.reduce((n, b) => n + b.length, 0);
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${n.toString().padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
