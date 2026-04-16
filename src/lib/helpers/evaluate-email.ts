import type { ApolloEnrichedPerson } from "../apollo/index.js";

export function evaluateEmail(person: ApolloEnrichedPerson): {
  emailStatus: "valid" | "invalid" | "risky" | "unknown";
  reason: string;
} {
  if (!person.email) return { emailStatus: "invalid", reason: "no_email" };
  if (person.email_status === "verified") {
    if (person.email_domain_catchall === true) {
      return { emailStatus: "risky", reason: "catchall_domain" };
    }
    if (person.extrapolated_email_confidence) {
      return { emailStatus: "risky", reason: "extrapolated_email" };
    }
    return { emailStatus: "valid", reason: "verified" };
  }
  if (person.email_status === "unavailable" || !person.email_status) {
    return {
      emailStatus: "unknown",
      reason: `email_status_${person.email_status || "null"}`,
    };
  }
  return {
    emailStatus: "risky",
    reason: `email_status_${person.email_status}`,
  };
}
