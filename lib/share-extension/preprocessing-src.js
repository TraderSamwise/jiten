import { Readability } from "@mozilla/readability";

class ShareExtensionPreprocessor {
  run(args) {
    try {
      const doc = document.cloneNode(true);
      const article = new Readability(doc).parse();
      if (article) {
        args.completionFunction({
          title: article.title || document.title || "",
          content: article.textContent || "",
          url: document.URL || "",
          byline: article.byline || "",
          excerpt: article.excerpt || "",
        });
      } else {
        // Readability returned null — fall back to body text
        args.completionFunction({
          title: document.title || "",
          content: document.body.innerText || "",
          url: document.URL || "",
          byline: "",
          excerpt: "",
        });
      }
    } catch (e) {
      // Readability threw — fall back to body text
      args.completionFunction({
        title: document.title || "",
        content: document.body.innerText || "",
        url: document.URL || "",
        byline: "",
        excerpt: "",
      });
    }
  }
}

// Must be a global for iOS Share Extension
globalThis.ExtensionPreprocessingJS = new ShareExtensionPreprocessor();
