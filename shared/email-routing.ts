/** Subject markers route mail without allocating a provider inbox per account. */
export function subjectMarker(token: string): string {
  return `[Rehearsal:${token}]`;
}

export function routingTokenFromSubject(
  subject: string | undefined,
): string | null {
  if (!subject) return null;
  if ([...subject.matchAll(/\[Rehearsal:/gi)].length !== 1) return null;
  const markers = [...subject.matchAll(/\[Rehearsal:([^\]]*)\]/gi)];
  if (markers.length !== 1) return null;
  const token = markers[0][1];
  return /^[a-f0-9]{32}$/.test(token) ? token : null;
}

export function sharedInboxAddress(value: string | undefined): string | null {
  const address = value?.trim();
  return address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
    ? address
    : null;
}
