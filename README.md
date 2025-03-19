<p align="center">
自动更新 vite.config.ts 中的 optimizeDeps.include 配置项
</p>

## 📦 安装

```bash

# vite-plugin-auto-optimize-deps-include

pnpm install vite-plugin-auto-optimize-deps-include -D

```

## 🦄 使用

### Configuration Vite

```ts
import { defineConfig, } from 'vite'

import VitePluginAutoOptimizeDepsInclude from 'vite-plugin-auto-optimize-deps-include'

export default defineConfig({
  plugins: [
    VitePluginAutoOptimizeDepsInclude(),
  ],
})
```
