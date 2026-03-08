export const Platform = { OS: "ios" };

// Mock AppState for sync-provider tests
type AppStateListener = (state: string) => void;
const listeners: AppStateListener[] = [];

export const AppState = {
  currentState: "active",
  addEventListener: (_type: string, listener: AppStateListener) => {
    listeners.push(listener);
    return {
      remove: () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    };
  },
  // Test helper: simulate app state change
  _simulateChange: (state: string) => {
    AppState.currentState = state;
    for (const l of [...listeners]) l(state);
  },
  _reset: () => {
    listeners.length = 0;
    AppState.currentState = "active";
  },
};
