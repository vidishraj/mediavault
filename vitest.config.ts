/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

// Pin NODE_ENV for the test run. Our box sets NODE_ENV=production, under which
// React's production build rejects act() and the hook test fails for a purely
// environmental reason. A suite's determinism must not depend on the ambient
// shell — pinning it here is correct engineering, and it is scoped to the test
// config so the app's build/dev (vite.config.ts) is unaffected.
process.env.NODE_ENV = 'development';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Per-file environments are set via `// @vitest-environment` docblocks
      // (jsdom for the hook test; node for the rest).
    },
  }),
);
