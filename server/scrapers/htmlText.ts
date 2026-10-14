import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

const MAX_SCRAPED_HTML_CHARACTERS = 256 * 1024;
const OMITTED_TAGS = new Set(["iframe", "noscript", "object", "script", "style", "svg", "template"]);
const SEPARATING_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
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

  function visit(node: HtmlNode): void {
    if (node.nodeName === "#text" && "value" in node) {
      text.push(node.value);
      return;
    }
    if (!("tagName" in node)) {
      if ("childNodes" in node) node.childNodes.forEach(visit);
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (OMITTED_TAGS.has(tag)) return;
    const separates = SEPARATING_TAGS.has(tag);
    if (separates) text.push(" ");
    node.childNodes.forEach(visit);
    if (separates) text.push(" ");
  }

  fragment.childNodes.forEach(visit);
  return text.join("").replace(/\s+/g, " ").trim();
}
