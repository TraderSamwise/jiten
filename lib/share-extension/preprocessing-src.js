import { Readability } from "@mozilla/readability";

class ShareExtensionPreprocessor {
  run(args) {
    try {
      const doc = document.cloneNode(true);
      const article = new Readability(doc).parse();
      // Grab og:image for article thumbnail
      const ogImage =
        document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
        document.querySelector('meta[name="og:image"]')?.getAttribute("content") ||
        "";

      if (article) {
        args.completionFunction({
          title: article.title || document.title || "",
          content: article.textContent || "",
          url: document.URL || "",
          byline: article.byline || "",
          excerpt: article.excerpt || "",
          imageUrl: ogImage,
        });
      } else {
        // Readability returned null — fall back to body text
        args.completionFunction({
          title: document.title || "",
          content: document.body.innerText || "",
          url: document.URL || "",
          byline: "",
          excerpt: "",
          imageUrl: ogImage,
        });
      }
    } catch (e) {
      // Readability threw — fall back to body text
      const fallbackOg =
        document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
      args.completionFunction({
        title: document.title || "",
        content: document.body.innerText || "",
        url: document.URL || "",
        byline: "",
        excerpt: "",
        imageUrl: fallbackOg,
      });
    }
  }
}

// Must be a global for iOS Share Extension
globalThis.ExtensionPreprocessingJS = new ShareExtensionPreprocessor();
