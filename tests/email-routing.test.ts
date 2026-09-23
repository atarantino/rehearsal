import test from "node:test";
import assert from "node:assert/strict";
import {
  routingTokenFromSubject,
  sharedInboxAddress,
  subjectMarker,
} from "../shared/email-routing";
const token = "abcdef0123456789abcdef0123456789";
test("routing requires one complete subject marker", () => {
  assert.equal(
    routingTokenFromSubject(`Fwd: Invitation ${subjectMarker(token)}`),
    token,
  );
  for (const subject of [
    undefined,
    "Invitation",
    "[Rehearsal:short]",
    `${subjectMarker(token)} ${subjectMarker(token)}`,
    `${subjectMarker(token)} [Rehearsal:broken`,
  ])
    assert.equal(routingTokenFromSubject(subject), null);
});
test("shared inbox configuration accepts only a single address", () => {
  assert.equal(
    sharedInboxAddress(" shared@agentmail.to "),
    "shared@agentmail.to",
  );
  for (const input of [
    undefined,
    "",
    "no address",
    "Name <shared@agentmail.to>",
    "a@b.com other@b.com",
  ])
    assert.equal(sharedInboxAddress(input), null);
});
