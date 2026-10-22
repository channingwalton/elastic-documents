import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest blanks CSS by default, even with ?raw; the stylesheet test reads it.
    css: true,
  },
})
