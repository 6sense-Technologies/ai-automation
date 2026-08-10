/**
 * Minimal Atlassian Document Format (ADF) builders — just enough to render
 * pipeline reports as readable Jira comments.
 */
export type AdfNode = Record<string, unknown>;

export const doc = (...content: AdfNode[]): AdfNode => ({
  type: "doc",
  version: 1,
  content,
});

export const heading = (level: number, text: string): AdfNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

export const paragraph = (...content: AdfNode[]): AdfNode => ({
  type: "paragraph",
  content,
});

export const text = (value: string): AdfNode => ({ type: "text", text: value });

export const strong = (value: string): AdfNode => ({
  type: "text",
  text: value,
  marks: [{ type: "strong" }],
});

export const code = (value: string): AdfNode => ({
  type: "text",
  text: value,
  marks: [{ type: "code" }],
});

export const codeBlock = (content: string, language = ""): AdfNode => ({
  type: "codeBlock",
  attrs: language ? { language } : {},
  content: content ? [{ type: "text", text: content }] : [],
});

export const bulletList = (...items: AdfNode[][]): AdfNode => ({
  type: "bulletList",
  content: items.map((nodes) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: nodes }],
  })),
});

/** paragraph containing "Label: value" with a bold label. */
export const field = (label: string, value: string): AdfNode =>
  paragraph(strong(`${label}: `), text(value || "—"));
