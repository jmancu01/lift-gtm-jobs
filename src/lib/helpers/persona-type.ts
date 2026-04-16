export function computePersonaType(title: string | null): string {
  const t = (title || "").toLowerCase();
  if (t.includes("transformation")) return "Transformation Practitioners";
  if (
    t.includes("cfo") ||
    t.includes("chief financial") ||
    t.includes("finance") ||
    t.includes("analytics") ||
    t.includes("data reporting")
  ) {
    return "Finance & Generic Practitioners";
  }
  if (
    t.includes("ceo") ||
    t.includes("coo") ||
    t.includes("chief executive") ||
    t.includes("chief operating") ||
    t.includes("claims") ||
    t.includes("operations") ||
    t.includes("underwriting")
  ) {
    return "Operations Leaders";
  }
  return "Unclassified";
}

export function personaTypeFromGroup(groupName: string): string {
  switch (groupName) {
    case "Transformation":
      return "Transformation Practitioners";
    case "Finance":
      return "Finance & Generic Practitioners";
    case "Operations":
      return "Operations Leaders";
    default:
      return "Operations Leaders";
  }
}
