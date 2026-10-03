/**
 * Enough of Wiktionary's wikitext to render a kanji's "Glyph origin" section as
 * plain prose. Not a wikitext engine: the section uses about fifteen templates
 * (measured over the RTK frames), and an unknown one is dropped rather than
 * guessed at — a template printed raw would read as noise in the app.
 */

interface Params {
  positional: string[];
  named: Record<string, string>;
}

/** Split on top-level `|`, ignoring the ones inside nested templates or links. */
function splitParams(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      current += two;
      i++;
    } else if (two === "}}" || two === "]]") {
      depth--;
      current += two;
      i++;
    } else if (body[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += body[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseParams(body: string): { name: string; params: Params } {
  const [head, ...rest] = splitParams(body);
  const params: Params = { positional: [], named: {} };
  for (const part of rest) {
    const eq = part.indexOf("=");
    // A `=` inside a nested template is not a parameter name.
    if (eq > 0 && !/[[{]/.test(part.slice(0, eq))) {
      params.named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    } else {
      params.positional.push(part.trim());
    }
  }
  return { name: head.trim(), params };
}

/** A term as Wiktionary prints it: the glyph, then its gloss in parentheses. */
function term(glyph: string, gloss?: string): string {
  // `*` marks a reconstructed Old Chinese form; it is noise outside a
  // reconstruction, where the glyph is the thing being pointed at.
  const clean = glyph.replace(/^\*/, "").trim();
  if (!clean) return "";
  return gloss?.trim() ? `${clean} (${gloss.trim()})` : clean;
}

const LIUSHU: Record<string, string> = {
  p: "Pictogram",
  i: "Ideogram",
  ic: "Ideogrammic compound",
  psc: "Phono-semantic compound",
  pb: "Phonetic borrowing",
};

function decap(text: string, params: Params): string {
  if (params.named.nocap !== "y" && params.named.nocap !== "yes") return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** `{{Han compound|水|每|c1=s|c2=p|alt1=氵|t1=water|ls=psc}}` */
function hanCompound(params: Params): string {
  const pieces = params.positional
    .map((glyph, i) => {
      const n = i + 1;
      const shown = params.named[`alt${n}`] || glyph;
      const named = term(shown, params.named[`t${n}`]);
      if (!named) return "";
      const role = params.named[`c${n}`];
      const prefix = role === "s" ? "semantic " : role === "p" ? "phonetic " : "";
      return prefix + named;
    })
    .filter(Boolean);
  if (pieces.length === 0) return "";
  const kind = LIUSHU[params.named.ls] ?? "Compound";
  return `${decap(kind, params)}: ${pieces.join(" + ")}`;
}

/** The `l`/`m` family: a link to a term, in one of several parameter orders. */
function linkTemplate(name: string, params: Params): string {
  // `l`/`m` name the language first (`{{m|zh|鹿|t=deer}}`); the per-language
  // shorthands do not (`{{och-l|閒|space, gap}}`), and their second parameter
  // is the gloss rather than an alternative spelling.
  const hasLang = /^(l|m|noncog|cog|lang)$/.test(name);
  const glyph = hasLang ? (params.positional[1] ?? "") : (params.positional[0] ?? "");
  const alt = hasLang ? params.positional[2] : undefined;
  const tail = hasLang ? params.positional[3] : params.positional[1];
  const gloss = params.named.t || params.named.gloss || tail || "";
  const shown = term(alt || glyph, gloss);
  if (name === "noncog") return shown ? `unrelated to ${shown}` : "";
  return shown;
}

function renderTemplate(body: string): string {
  const { name, params } = parseParams(body);
  const lower = name.toLowerCase();

  if (lower === "han compound") return hanCompound(params);
  if (lower === "liushu") {
    const kind = LIUSHU[params.positional[0]] ?? "";
    return kind ? decap(kind, params) : "";
  }
  if (lower === "han simp") {
    const from = term(params.positional[0] ?? "");
    const f = params.named.f;
    const t = params.named.t;
    if (!from) return "";
    const how = f && t ? ` (${f} → ${t})` : "";
    return decap(`Simplified from ${from}${how}`, params);
  }
  if (lower === "m-g") return params.positional[0] ?? "";
  if (lower === "w") return params.positional[1] || params.positional[0] || "";
  if (/^(l|m|noncog|cog|lang|zh-l|zh-m|och-l|ltc-l)(-lite)?$/.test(lower)) {
    return linkTemplate(lower.replace(/-lite$/, ""), params);
  }
  // Banners, stubs, citations, cross-reference boxes: nothing a reader needs.
  return "";
}

/** Expand every template, innermost first so a nested one is already prose. */
function expandTemplates(src: string): string {
  let text = src;
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      changed = true;
      return renderTemplate(body);
    });
    if (!changed) break;
  }
  // An unbalanced brace would otherwise leak markup into the app.
  return text.replace(/\{\{|\}\}/g, "");
}

/** Drop `[[File:...]]` whole, captions and nested markup included. */
function stripFileLinks(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    if (!/^\[\[(File|Image):/i.test(src.slice(i, i + 9))) {
      out += src[i];
      continue;
    }
    let depth = 0;
    for (; i < src.length; i++) {
      if (src.slice(i, i + 2) === "[[") {
        depth++;
        i++;
      } else if (src.slice(i, i + 2) === "]]") {
        depth--;
        i++;
        if (depth === 0) break;
      }
    }
  }
  return out;
}

export function wikitextToPlain(src: string): string {
  let text = stripFileLinks(src);
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref[^>]*\/>/gi, "");
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = expandTemplates(text);
  text = text.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]*)\]\]/g, "$1");
  text = text.replace(/'''([^']+)'''/g, "$1");
  text = text.replace(/''([^']+)''/g, "$1");
  text = text.replace(/<\/?[a-z][^>]*>/gi, "");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  // Punctuation left stranded by a dropped template: " – ", ": .", " ()".
  text = text.replace(/\(\s*\)/g, "");
  text = text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/^[\s*#–—:;,.]+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return text.replace(/ ([.,;:])/g, "$1").trim();
}

/**
 * The first sentences that fit, for a card or a drill header. Cuts on a
 * sentence boundary rather than mid-word, and never returns a dangling clause.
 */
export function firstSentences(text: string, maxChars: number): string {
  // Newlines are list items as often as paragraphs; a line alone is often
  // just the lead-in ("Two possible interpretations:").
  const flat = text.split("\n").join(" ").replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  if (stop > maxChars * 0.4) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:–—]+$/, "") + "…";
}
