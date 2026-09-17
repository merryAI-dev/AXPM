function list(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isAuthorizedEmail(
  email: string | undefined,
  allowedEmails = process.env.ALLOWED_EMAILS,
  allowedDomains = process.env.ALLOWED_DOMAINS,
) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  if (list(allowedEmails).includes(normalized)) return true;
  const separator = normalized.lastIndexOf("@");
  if (separator < 1) return false;
  const domain = normalized.slice(separator + 1);
  return list(allowedDomains)
    .map((item) => item.replace(/^@/, ""))
    .includes(domain);
}

export function workspaceUidFor(
  authenticatedUid: string,
  configuredUid = process.env.AXPM_WORKSPACE_UID,
) {
  return configuredUid?.trim() || authenticatedUid;
}
