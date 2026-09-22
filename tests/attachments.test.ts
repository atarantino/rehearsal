import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { attachmentText, readAttachmentBody } from "../server/attachment-text";
import { attachmentKind, MAX_ATTACHMENT_BYTES } from "../shared/attachments";
const fixture = async (name: string) =>
  new Uint8Array(
    await readFile(new URL(`./documents/${name}`, import.meta.url)),
  );
test("reads real PDF and DOCX prep materials", async () => {
  for (const [name, kind] of [
    ["resume.pdf", "pdf"],
    ["resume.docx", "docx"],
  ] as const) {
    const result = await attachmentText(await fixture(name), kind);
    assert.match(result.text, /Led a design team of 12 people/);
    assert.equal(result.truncated, false);
  }
});
test("reports scanned, locked and malformed files instead of inventing content", async () => {
  await assert.rejects(
    attachmentText(await fixture("scan.pdf"), "pdf"),
    /No readable text/,
  );
  await assert.rejects(attachmentText(await fixture("protected.pdf"), "pdf"));
  await assert.rejects(attachmentText(strToU8("broken"), "docx"));
  await assert.rejects(attachmentText(new Uint8Array([255, 254]), "text"));
});
test("bounds file bytes, expanded DOCX archives, and extracted text", async () => {
  await assert.rejects(
    attachmentText(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), "text"),
    /5 MB/,
  );
  const archive = zipSync({
    "word/document.xml": new Uint8Array(21 * 1024 * 1024),
  });
  await assert.rejects(attachmentText(archive, "docx"), /Expanded document/);
  const result = await attachmentText(strToU8("study ".repeat(3000)), "text");
  assert.equal(result.text.length, 12000);
  assert.equal(result.truncated, true);
});
test("enforces streaming download limits without trusting content-length", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }),
  );
  await assert.rejects(readAttachmentBody(response, 5), /size limit/);
  assert.deepEqual(
    await readAttachmentBody(new Response("guide"), 5),
    strToU8("guide"),
  );
  assert.equal(attachmentKind("guide.DOCX"), "docx");
  assert.equal(attachmentKind("logo.png", "image/png"), null);
});
