import WordNet from "node-wordnet";
import wordnetDb from "wordnet-db";
import type { DictMigration } from "../migrate-dict";

const migration: DictMigration = {
  version: 15,
  description: "Rebuild synonyms table from WordNet (restore missing pairs)",
  async migrate(db) {
    // Step 1: Extract gloss vocabulary — all unique content words from English glosses
    console.log("  Extracting gloss vocabulary...");
    const glossRows = db.prepare(`SELECT glosses FROM senses`).all() as { glosses: string }[];

    const glossVocab = new Set<string>();
    const wordPattern = /[a-z]{3,}/g;
    for (const row of glossRows) {
      try {
        const glosses = JSON.parse(row.glosses) as { lang: string; text: string }[];
        for (const g of glosses) {
          if (g.lang !== "eng") continue;
          const words = g.text.toLowerCase().match(wordPattern);
          if (words) {
            for (const w of words) glossVocab.add(w);
          }
        }
      } catch {}
    }
    console.log(`  ${glossVocab.size} unique vocabulary words`);

    // Step 2: Drop and recreate synonyms table
    db.exec(`DROP TABLE IF EXISTS synonyms`);
    db.exec(`
      CREATE TABLE synonyms (
        word TEXT NOT NULL,
        synonym TEXT NOT NULL
      )
    `);

    const insertSynonym = db.prepare("INSERT INTO synonyms (word, synonym) VALUES (?, ?)");
    const insertBatch = db.transaction((pairs: { word: string; synonym: string }[]) => {
      for (const p of pairs) {
        insertSynonym.run(p.word, p.synonym);
      }
    });

    // Step 3: Look up WordNet relationships for each vocabulary word
    const wn = new WordNet(wordnetDb.path);
    const RELATED_PTRS = new Set(["+", "&", "~"]); // derivational, similar-to, hyponym
    let synCount = 0;
    let wordsDone = 0;
    const vocabArray = [...glossVocab];

    const BATCH_SIZE = 500;
    for (let i = 0; i < vocabArray.length; i += BATCH_SIZE) {
      const batch = vocabArray.slice(i, i + BATCH_SIZE);
      const pairs: { word: string; synonym: string }[] = [];

      await Promise.all(
        batch.map(async (word) => {
          try {
            const results = await wn.lookupAsync(word);
            const wordSyns: { word: string; synonym: string }[] = [];

            for (const result of results) {
              // Direct synset synonyms
              for (const syn of result.synonyms) {
                const normalized = syn.toLowerCase().replace(/_/g, " ");
                if (
                  !normalized.includes(" ") &&
                  normalized.length >= 3 &&
                  glossVocab.has(normalized) &&
                  normalized !== word
                ) {
                  wordSyns.push({ word, synonym: normalized });
                }
              }

              // Related forms: derivational (+), similar-to (&), hyponyms (~)
              for (const ptr of result.ptrs) {
                if (!RELATED_PTRS.has(ptr.pointerSymbol)) continue;
                try {
                  const related = await wn.getAsync(ptr.synsetOffset, ptr.pos);
                  for (const syn of related.synonyms) {
                    const normalized = syn.toLowerCase().replace(/_/g, " ");
                    if (
                      !normalized.includes(" ") &&
                      normalized.length >= 3 &&
                      glossVocab.has(normalized) &&
                      normalized !== word
                    ) {
                      wordSyns.push({ word, synonym: normalized });
                    }
                  }
                } catch {}
              }
            }

            // Deduplicate per-word synonyms then push to shared array
            const seen = new Set<string>();
            for (const s of wordSyns) {
              if (!seen.has(s.synonym)) {
                seen.add(s.synonym);
                pairs.push(s);
              }
            }
          } catch {}
        }),
      );

      insertBatch(pairs);
      synCount += pairs.length;
      wordsDone += batch.length;
      if (wordsDone % 5000 === 0 || wordsDone === vocabArray.length) {
        console.log(
          `  ${wordsDone}/${vocabArray.length} words processed, ${synCount} synonym pairs so far...`,
        );
      }
    }

    // Create indexes on both columns for bidirectional lookups
    db.exec(`CREATE INDEX idx_synonyms_word ON synonyms(word)`);
    db.exec(`CREATE INDEX idx_synonyms_synonym ON synonyms(synonym)`);
    console.log(`  ${synCount} synonym pairs inserted (with bidirectional indexes)`);
  },
};

export default migration;
