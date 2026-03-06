declare module "node-wordnet" {
  class WordNet {
    constructor(options?: any);
    lookup(word: string, callback: (results: any[]) => void): void;
    lookupAsync(word: string): Promise<any[]>;
    getAsync(synsetOffset: number, pos: string): Promise<any>;
  }
  export = WordNet;
}
