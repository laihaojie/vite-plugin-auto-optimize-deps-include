import type { PluginOption } from 'vite'
import fs from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import MagicString from 'magic-string'

interface Option {
  /**
   * 匹配的正则
   * @default /new dependencies optimized:(.*)\n/
   */
  regex?: RegExp
  /**
   * 要修改的配置文件路径（相对于项目根目录）
   * @default vite.config.ts
   */
  configFile?: string
  /**
   * 标记 optimizeDeps.include 数组位置的注释
   * 在 vite.config.ts 中，在 include: [...] 上方添加此注释即可被插件识别
   * @default '// @auto-deps'
   */
  marker?: string
}

const DEFAULT_REGEX = /new dependencies optimized:(.*)\n/
const DEFAULT_MARKER = '// @auto-deps'
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*m/g

function VitePluginAutoOptimizeDepsInclude(option: Option = {}): PluginOption {
  const regex = option.regex || DEFAULT_REGEX
  const configFile = option.configFile || 'vite.config.ts'
  const marker = option.marker || DEFAULT_MARKER

  return {
    name: 'update-optimizeDeps-include',
    apply: 'serve',
    enforce: 'pre',
    configureServer: (server) => {
      const originalWrite = process.stdout.write
      const viteConfigPath = resolve(process.cwd(), configFile)
      let closed = false

      if (!fs.existsSync(viteConfigPath)) {
        server.config.logger.warn(
          `[update-optimizeDeps-include] 配置文件不存在: ${viteConfigPath}`,
        )
        return
      }

      process.stdout.write = function (...args: any[]) {
        const r = originalWrite.apply(process.stdout, args as any)
        if (closed) return r

        const raw = args[0]
        if (typeof raw !== 'string' && typeof raw !== 'object') return r
        const str = String(raw)
        if (!str.includes('new dependencies optimized')) return r

        const cleanStr = str.replace(ANSI_REGEX, '')
        handle(cleanStr)
        return r
      }

      server.httpServer?.on('close', () => {
        closed = true
        process.stdout.write = originalWrite
      })

      function handle(dependenciesStr: string) {
        const data = dependenciesStr.match(regex)
        if (!data) return

        const newDeps = data[1]
          .split(',')
          .map(i => i.trim())
          .filter(Boolean)
        if (newDeps.length === 0) return

        let configContent: string
        try {
          configContent = fs.readFileSync(viteConfigPath, 'utf-8')
        }
        catch (e: any) {
          server.config.logger.warn(`[update-optimizeDeps-include] 读取失败: ${e.message}`)
          return
        }

        const range = findOptimizeIncludeRange(configContent, marker)
        if (!range) {
          server.config.logger.warn(
            `[update-optimizeDeps-include] 未在 ${configFile} 中找到标记 "${marker}"，`
            + `请检查：配置文件路径是否正确，或是否忘记在 include 数组上方添加 ${marker} 注释`,
          )
          return
        }

        const { startIndex, endIndex, indent } = range
        const currentList = configContent
          .slice(startIndex, endIndex)
          .split(',')
          .map(i => i.replace(/['"]/g, '').trim())
          .filter(i => i && !i.startsWith('//'))

        const merged = new Set([...currentList, ...newDeps])
        const newList = Array.from(merged)
          .filter(i => !i.startsWith('//'))
          .sort((a, b) => a.localeCompare(b))

        // 无变化则跳过写入
        if (
          newList.length === currentList.length
          && newList.every((dep, i) => dep === currentList[i])
        ) {
          return
        }

        const str = new MagicString(configContent)
        const newStr
          = newList.reduce((pre, cur) => `${pre}${' '.repeat(indent + 2)}'${cur}',
`, '\n')
            + ' '.repeat(indent)
        str.update(startIndex, endIndex, newStr)

        try {
          server.watcher.unwatch(viteConfigPath)
          const { atime, mtime } = fs.statSync(viteConfigPath)
          fs.writeFileSync(viteConfigPath, str.toString())
          fs.utimesSync(viteConfigPath, atime, mtime)
          server.watcher.add(viteConfigPath)
        }
        catch (e: any) {
          server.config.logger.warn(`[update-optimizeDeps-include] 写入失败: ${e.message}`)
        }
      }
    },
  }
}

/**
 * 找到 marker 注释后第一个 [ 到其匹配的 ] 的范围
 */
function findOptimizeIncludeRange(content: string, marker: string) {
  const markerIndex = content.indexOf(marker)
  if (markerIndex === -1) return null

  const bracketStart = content.indexOf('[', markerIndex + marker.length)
  if (bracketStart === -1) return null

  let depth = 0
  for (let i = bracketStart + 1; i < content.length; i++) {
    if (content[i] === '[') depth++
    if (content[i] === ']') {
      if (depth === 0) {
        const lineStart = content.lastIndexOf('\n', markerIndex) + 1
        const indent = markerIndex - lineStart
        return { startIndex: bracketStart + 1, endIndex: i, indent }
      }
      depth--
    }
  }
  return null
}

export default VitePluginAutoOptimizeDepsInclude
