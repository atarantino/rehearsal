# Email preparation attachments

Forward invitations with their original attachments to the existing private
preparation inbox. New messages import PDF, DOCX, TXT and Markdown text before
extracting opportunity details and writing the brief. The resulting brief is
snapshotted into the mock interviewer’s existing voice context.

Limits: 10 files per email, 5 MB per file, 15 MB downloaded per import attempt
(including retained successful imports), 30 PDF pages, and 12,000 extracted
characters per file. Truncation is shown explicitly. DOCX expanded archives are
bounded to 20 MB and 1,000 entries. Scanned PDFs/images need OCR and are not
imported automatically; locked, malformed and unsupported files show a reason.

Each file shows its status under Prep materials. A failed file does not discard
other files or the email body. Retry attachment import rebuilds the brief while
retaining successful imports. Messages containing only attachments are accepted.
Existing processed emails are unchanged; forward them again to import materials.

Attachment IDs are resolved through the authenticated AgentMail API. Only its
issued HTTPS download URLs are fetched, with bounded streaming reads, timeouts,
and no redirects. Provider credentials are never sent to download URLs. Raw files
are processed in memory; extracted text is stored with the owner’s opportunity.
Private attachment source citations link to file status in the workspace. They
are not presented as independently verified public research. Source text remains
untrusted reference data in model prompts.

Verification (2026-09-22):

- 26 Node tests and 31 Convex tests passed, including real PDF/DOCX extraction,
  scanned/locked/malformed documents, byte/text/archive limits, attachment-only
  intake, duplicate webhooks, ownership, bounded metadata, provider download
  handling, partial failure/retry, and attachment-to-brief-to-session context.
- 18 existing browser tests passed. Authenticated development checks also showed
  file statuses and retry controls at 1440, 390 and 320px without overflow, then
  selected the correct prepared mock session (simulated voice transport).
- TypeScript and production build passed. Development push and the deployed Node
  action smoke passed on quick-starfish-327.
- Provider downloads and webhook delivery were simulated in tests; no real email
  was sent for this verification. Existing real Firecrawl/voice verification is
  documented separately in experience-verification.md.
