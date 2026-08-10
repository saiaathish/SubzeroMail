import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

const ALLOWED_ATTRIBUTES = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "width", "height", "title", "loading"],
  ol: ["start"],
  table: ["border", "cellpadding", "cellspacing"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

const SAFE_DATA_IMAGE =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;

export interface SanitizeEmailOptions {
  /**
   * Off by default. Call only after an explicit user action such as
   * "Load images" and sanitize the original message again.
   */
  allowRemoteImages?: boolean;
}

export interface SanitizedEmail {
  html: string;
  blockedRemoteImages: number;
}

/**
 * Sanitize untrusted email HTML. Scripts, event handlers, forms, unsafe URLs,
 * and remote images are removed by default.
 */
export function sanitizeEmailHtml(
  value: unknown,
  options: SanitizeEmailOptions = {},
): string {
  return sanitizeEmailHtmlWithMetadata(value, options).html;
}

/**
 * Same sanitizer plus the remote-image count needed to offer a user-controlled
 * "Load images" action without loading anything automatically.
 */
export function sanitizeEmailHtmlWithMetadata(
  value: unknown,
  options: SanitizeEmailOptions = {},
): SanitizedEmail {
  const source = typeof value === "string" ? value : "";
  const allowRemoteImages = options.allowRemoteImages === true;
  let blockedRemoteImages = 0;

  const html = sanitizeHtml(source, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: allowRemoteImages ? ["http", "https", "data"] : ["data"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: {
          ...attributes,
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      img: (tagName, attributes) => {
        const src = attributes.src?.trim();
        const { src: _src, ...safeAttributes } = attributes;

        if (!src) {
          return { tagName, attribs: safeAttributes };
        }

        if (!allowRemoteImages && isRemoteImageSource(src)) {
          blockedRemoteImages += 1;
          return { tagName, attribs: safeAttributes };
        }

        if (
          src.toLowerCase().startsWith("data:") &&
          !SAFE_DATA_IMAGE.test(src)
        ) {
          return { tagName, attribs: safeAttributes };
        }

        return { tagName, attribs: { ...safeAttributes, src } };
      },
    },
  });

  return { html, blockedRemoteImages };
}

/**
 * Text-only fallback for malformed or unsupported email HTML. It removes active
 * content before extracting readable text and strips control characters.
 */
export function safeTextFallback(value: unknown): string {
  const source = typeof value === "string" ? value : "";
  if (!source) {
    return "";
  }

  try {
    return normalizeSafeText(
      sanitizeHtml(source, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: "discard",
      }),
    );
  } catch {
    return normalizeSafeText(
      source
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
        .replace(/<!--([\s\S]*?)-->/g, "")
        .replace(/<[^>]*>/g, " "),
    );
  }
}

export const emailHtmlToSafeText = safeTextFallback;

function isRemoteImageSource(src: string): boolean {
  const normalized = src.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("//")
  );
}

function normalizeSafeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
