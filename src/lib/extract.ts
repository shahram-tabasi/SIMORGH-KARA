import "server-only";

/**
 * The text of an uploaded document, for company knowledge: PDF (its text
 * layer), Word (.docx), plain text or Markdown. A scanned PDF has no text
 * layer: that comes back empty, and the caller says so (no OCR here).
 */
export async function extractText(data: Buffer, name: string, mime: string): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await pdfText(pdf, { mergePages: false });
    return (Array.isArray(text) ? text : [text]).map((p) => p.trim()).filter(Boolean).join("\n\n");
  }
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: data });
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }
  if (["txt", "md"].includes(ext) || mime.startsWith("text/")) return data.toString("utf8").trim();
  throw new Error("فقط PDF، Word (docx)، متن یا Markdown پذیرفته می‌شود.");
}
