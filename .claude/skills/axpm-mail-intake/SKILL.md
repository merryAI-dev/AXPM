---
name: axpm-mail-intake
description: Inspect and collect Gmail attachments through the AXPM MCP using the operator's individually authorized Google account.
---

Start with `axpm_inspect_mail_intake`. If `connected` is false, tell the operator to use **내 Google 계정 연동하기** in AXPM. Do not request domain-wide delegation or a Gmail password.

Use the `query` field of `axpm_inspect_mail_intake` for simple searches across subject, sender, original filename, and stored filename. The tool returns attachment metadata, not message bodies. Do not imply that it searched body text.

Call `axpm_sync_mail_attachments` only when the current user asks to collect new attachments. Report collected, normalized, review, skipped, and errors separately. A normalized XLSX has been matched against report-body identity and the master. Other formats and ambiguous or conflicting names remain review items.

The connected mailbox belongs to the shared AXPM workspace, but access originates from one user's OAuth consent and can be revoked in AXPM. Never ask for or store a Google access token, refresh token, client secret, or password in chat.
