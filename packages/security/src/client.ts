// Browser-safe security surface. Encryption and log redaction remain server-only.
export {
  safeTextFallback,
  sanitizeEmailHtml,
  sanitizeEmailHtmlWithMetadata,
} from "./sanitize";
