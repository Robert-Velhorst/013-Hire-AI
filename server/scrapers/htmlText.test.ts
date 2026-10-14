import { describe, expect, it } from "vitest";
import { cleanScrapedHtmlToText } from "./htmlText";

describe("scraped HTML text normalization", () => {
  it("removes markup and decodes common entities in one pass", () => {
    expect(cleanScrapedHtmlToText("<p>Engineer&nbsp;&amp; data</p>"))
      .toBe("Engineer & data");
  });

  it("does not recursively decode nested markup entities", () => {
    expect(cleanScrapedHtmlToText("&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;"))
      .toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("normalizes quoted apostrophe entities without a second decode", () => {
    expect(cleanScrapedHtmlToText("&quot;Hire&#39;s job&amp;lt;&quot;"))
      .toBe('"Hire\'s job&lt;"');
  });

  it("omits script, style, template, and embedded content", () => {
    expect(cleanScrapedHtmlToText(
      "<style>.hidden { display:none }</style><script>steal()</script><template>draft</template><iframe>frame</iframe><p>Remote role</p>"
    )).toBe("Remote role");
  });

  it("decodes full HTML entities and preserves readable spacing in malformed fragments", () => {
    expect(cleanScrapedHtmlToText("<p>Research &copy; 2026</p><p>Role &#x1F4BC;<div>Remote"))
      .toBe("Research © 2026 Role \u{1F4BC} Remote");
  });

  it("bounds parsing for unusually large provider responses", () => {
    const output = cleanScrapedHtmlToText(`<p>${"x".repeat(300_000)}</p>`);
    expect(output.length).toBeLessThanOrEqual(256 * 1024);
    expect(output.length).toBeGreaterThan(250 * 1024);
  });

  it("separates text across common block-level elements", () => {
    expect(cleanScrapedHtmlToText(
      "<main>Remote</main><aside>Engineer</aside><header>Open</header><footer>Role</footer><form><fieldset>Now</fieldset></form><figure>Apply</figure>"
    )).toBe("Remote Engineer Open Role Now Apply");
  });

  it("walks deeply nested provider markup without recursive stack growth", () => {
    const depth = 25_000;
    const html = `${"<i>".repeat(depth)}Deep${"</i>".repeat(depth)}`;
    expect(cleanScrapedHtmlToText(html)).toBe("Deep");
  });
});
