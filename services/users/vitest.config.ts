import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.test", override: true });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["./src/**/*.test.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    hookTimeout: 60 * 1000, // To give some time for the MongoDB binary to download
    // Serialize test files to prevent Redis key race conditions between afterEach cleanups
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
