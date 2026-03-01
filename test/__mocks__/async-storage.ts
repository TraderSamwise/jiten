const store: Record<string, string> = {};

const mock = {
  getItem: async (key: string) => store[key] ?? null,
  setItem: async (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: async (key: string) => {
    delete store[key];
  },
  _clear: () => {
    for (const key of Object.keys(store)) delete store[key];
  },
  _getStore: () => store,
};

export default mock;
