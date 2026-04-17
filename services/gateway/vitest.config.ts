import { defineConfig } from "vitest/config";
import { config } from "dotenv";
import path from "path";

config({ path: ".env.test", override: true });

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@shared\/(.*)$/,
        replacement: path.join(__dirname, "../../shared/$1/src/index.ts"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["./src/**/*.test.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    hookTimeout: 60 * 1000, // To give some time for the MongoDB binary to download
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
