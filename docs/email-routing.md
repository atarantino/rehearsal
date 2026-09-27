# Account-linked email preparation

New accounts use one configured AgentMail inbox with a separate private routing
record for each Rehearsal account. Setup displays the shared forwarding address
and a subject marker such as `[Rehearsal:<random value>]`. Include the marker once
in the forwarded message subject. Messages with missing, unknown, malformed or
multiple markers are not imported. A marker on a different physical inbox does
not route to the account. Sender addresses, forwarded headers and message bodies
are never used to select an owner.

The marker is an **intake capability**: anyone who knows it can send material that
creates preparations and consumes the account's preparation allowance. It is not
a login credential and does not let the sender read the workspace. Keep it
private and share it only with people you want submitting preparation material.
Sender email ownership is not verified by this feature. Auto-replies are off by
default and require explicit opt-in.

Use **Replace and copy marker** in email preparation if a marker was disclosed.
This immediately revokes the old marker for future intake and copies the new
marker. If clipboard access fails, the new marker is still displayed for manual
copying. Update any saved forwarding templates. Already accepted preparations
stay with the same owner; their routing-record references are preserved. Messages
not yet processed when rotation completes must use the new marker. Retrying the
same replacement request returns the current marker without replacing it again.

Existing dedicated AgentMail inboxes continue to work and do not show a marker
replacement control. No new physical AgentMail inbox is allocated for each
account. The app owner must configure `AGENTMAIL_SHARED_INBOX_ID` and the normal
AgentMail API/webhook credentials before enabling shared email preparation.

If a valid invitation arrives after the account's preparation allowance is used,
the invitation and attachment metadata are saved privately as a failed
preparation with a clear retry message. No research workflow starts until an
allowed retry. Duplicate webhook delivery does not create duplicate preparations.
Sharing a mail thread does not combine ownership or suppress otherwise distinct
invitation messages.
