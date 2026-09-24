import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    // Process JSX in both .jsx and .js files
    react({ include: /\.(jsx|js)$/ }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
    environmentOptions: {
      jsdom: { url: 'http://localhost' },
    },
  },
});
