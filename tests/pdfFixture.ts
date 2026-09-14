// Small, self-contained PDF; no third-party document or personal data.
export function projectPdf(
  pages = ["Team launch reduced support tickets by 20 percent."],
) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const kids: string[] = [];
  for (const text of pages) {
    const pageId = objects.length + 1;
    kids.push(`${pageId} 0 R`);
    const lines = (text.match(/.{1,70}/g) || [""]).map((line) =>
      line.replace(/[\\()]/g, "\\$&"),
    );
    const content = `BT /F1 12 Tf 14 TL 30 700 Td ${lines.map((line) => `(${line}) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(document.length);
    document += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(document).buffer;
}
