import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  deps: {
    neverBundle: ['vite'],
  },
})
