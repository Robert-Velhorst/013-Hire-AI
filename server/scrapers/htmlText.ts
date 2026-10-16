import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

const MAX_SCRAPED_HTML_CHARACTERS = 256 * 1024;
const OMITTED_TAGS = new Set(["iframe", "noscript", "object", "script", "style", "svg", "template"]);
const SEPARATING_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figure",
  "figcaption",
  "footer",
  "form",
  "header",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

type HtmlNode = DefaultTreeAdapterMap["node"];

/** Extract readable provider text while excluding executable and hidden embedded content. */
export function cleanScrapedHtmlToText(value: string): string {
  const fragment = parseFragment(value.slice(0, MAX_SCRAPED_HTML_CHARACTERS));
  const text: string[] = [];
  const pending: Array<{ node: HtmlNode; exit: boolean }> = [];
  for (let index = fragment.childNodes.length - 1; index >= 0; index -= 1) {
    pending.push({ node: fragment.childNodes[index]!, exit: false });
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    const { node, exit } = current;
    if (node.nodeName === "#text" && "value" in node) {
      if (!exit) text.push(node.value);
      continue;
    }
    if (!("childNodes" in node)) continue;
    if (!("tagName" in node)) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.childNodes[index]!, exit: false });
      }
      continue;
    }

    const tag = node.tagName.toLowerCase();
    if (OMITTED_TAGS.has(tag)) continue;
    const separates = SEPARATING_TAGS.has(tag);
    if (exit) {
      if (separates) text.push(" ");
      continue;
    }
    if (separates) text.push(" ");
    pending.push({ node, exit: true });
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      pending.push({ node: node.childNodes[index]!, exit: false });
    }
  }

  return text.join("").replace(/\s+/g, " ").trim();
}
