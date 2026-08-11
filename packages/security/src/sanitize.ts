import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "caption",
  "center",
  "code",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "font",
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
  "*": ["style", "dir"],
  a: ["href", "title", "target", "rel"],
  font: ["color", "face", "size"],
  img: [
    "src",
    "alt",
    "width",
    "height",
    "title",
    "loading",
    "referrerpolicy",
  ],
  ol: ["start"],
  table: ["border", "cellpadding", "cellspacing", "width", "align", "bgcolor"],
  tbody: ["align", "valign"],
  td: ["colspan", "rowspan", "width", "height", "align", "valign", "bgcolor"],
  th: ["colspan", "rowspan", "width", "height", "align", "valign", "bgcolor"],
  tr: ["align", "valign", "bgcolor"],
};

const SAFE_STYLE_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|javascript\s*:)).+$/i;

const ALLOWED_STYLES = {
  "*": {
    color: [SAFE_STYLE_VALUE],
    "background-color": [SAFE_STYLE_VALUE],
    "text-align": [SAFE_STYLE_VALUE],
    "text-decoration": [SAFE_STYLE_VALUE],
    "font-family": [SAFE_STYLE_VALUE],
    "font-size": [SAFE_STYLE_VALUE],
    "font-style": [SAFE_STYLE_VALUE],
    "font-weight": [SAFE_STYLE_VALUE],
    "line-height": [SAFE_STYLE_VALUE],
    margin: [SAFE_STYLE_VALUE],
    "margin-top": [SAFE_STYLE_VALUE],
    "margin-right": [SAFE_STYLE_VALUE],
    "margin-bottom": [SAFE_STYLE_VALUE],
    "margin-left": [SAFE_STYLE_VALUE],
    padding: [SAFE_STYLE_VALUE],
    "padding-top": [SAFE_STYLE_VALUE],
    "padding-right": [SAFE_STYLE_VALUE],
    "padding-bottom": [SAFE_STYLE_VALUE],
    "padding-left": [SAFE_STYLE_VALUE],
    border: [SAFE_STYLE_VALUE],
    "border-top": [SAFE_STYLE_VALUE],
    "border-right": [SAFE_STYLE_VALUE],
    "border-bottom": [SAFE_STYLE_VALUE],
    "border-left": [SAFE_STYLE_VALUE],
    "border-collapse": [SAFE_STYLE_VALUE],
    "border-spacing": [SAFE_STYLE_VALUE],
    "border-radius": [SAFE_STYLE_VALUE],
    width: [SAFE_STYLE_VALUE],
    "min-width": [SAFE_STYLE_VALUE],
    "max-width": [SAFE_STYLE_VALUE],
    height: [SAFE_STYLE_VALUE],
    "min-height": [SAFE_STYLE_VALUE],
    "max-height": [SAFE_STYLE_VALUE],
    display: [SAFE_STYLE_VALUE],
    "vertical-align": [SAFE_STYLE_VALUE],
    "white-space": [SAFE_STYLE_VALUE],
  },
};

const SAFE_DATA_IMAGE =
  /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;

export interface SanitizeEmailOptions {
  /**
   * Kept for API compatibility. Subzero now follows Gmail-style display and
   * renders remote images automatically after sanitizing active content.
   */
  allowRemoteImages?: boolean;
}

export interface SanitizedEmail {
  html: string;
  blockedRemoteImages: number;
}

/**
 * Sanitize untrusted email HTML while preserving the layout primitives that
 * real-world HTML email relies on. Scripts, event handlers, forms, unsafe URLs,
 * CSS URL loads, and other active content are still removed. Remote <img>
 * sources are displayed automatically, matching the expected modern mail UI.
 */
export function sanitizeEmailHtml(
  value: unknown,
  options: SanitizeEmailOptions = {},
): string {
  return sanitizeEmailHtmlWithMetadata(value, options).html;
}

export function sanitizeEmailHtmlWithMetadata(
  value: unknown,
  _options: SanitizeEmailOptions = {},
): SanitizedEmail {
  const source = typeof value === "string" ? value : "";
  const allowRemoteImages = true;

  const html = sanitizeHtml(source, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
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

        if (
          src.toLowerCase().startsWith("data:") &&
          !SAFE_DATA_IMAGE.test(src)
        ) {
          return { tagName, attribs: safeAttributes };
        }

        return {
          tagName,
          attribs: {
            ...safeAttributes,
            src,
            loading: safeAttributes.loading ?? "lazy",
            referrerpolicy: "no-referrer",
          },
        };
      },
    },
  });

  return { html, blockedRemoteImages: allowRemoteImages ? 0 : 0 };
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

function normalizeSafeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
