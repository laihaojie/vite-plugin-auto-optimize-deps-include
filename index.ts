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
}

const DEFAULT_REGEX = /new dependencies optimized:(.*)\n/
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*m/g

function VitePluginAutoOptimizeDepsInclude(option: Option = {}): PluginOption {
  const regex = option.regex || DEFAULT_REGEX
  const configFile = option.configFile || 'vite.config.ts'

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

        const range = findOptimizeIncludeRange(configContent)
        if (!range) {
          server.config.logger.warn(
            `[update-optimizeDeps-include] 未在 ${configFile} 中找到 optimizeDeps.include 数组`,
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
 * 定位 optimizeDeps.include 数组的 [ 起始位置和 ] 结束位置
 * 策略：遍历所有 include: [...]，通过数组内容特征排除文件路径类的 include（如 AutoImport）
 */
function findOptimizeIncludeRange(content: string) {
  let searchFrom = 0

  while (true) {
    const match = content.slice(searchFrom).match(/include\s*:\s*\[/)
    if (!match) return null

    const bracketStart = searchFrom + match.index! + match[0].length
    const bracketEnd = findClosingBracket(content, bracketStart)
    if (bracketEnd === -1) return null

    const items = content
      .slice(bracketStart, bracketEnd)
      .split(',')
      .map(s => s.replace(/['"`]/g, '').trim())
      .filter(Boolean)

    // 判断是否是文件路径类 include（如 AutoImport/Components 的 src/** /*.vue）
    const looksLikeFilePaths = items.some(item =>
      item.includes('*') || item.includes('{') || item.startsWith('.'),
    )

    if (!looksLikeFilePaths) {
      const lineStart = content.lastIndexOf('\n', searchFrom + match.index!) + 1
      const indent = searchFrom + match.index! - lineStart
      return { startIndex: bracketStart, endIndex: bracketEnd, indent }
    }

    // 是文件路径，继续找下一个 include
    searchFrom = bracketStart + 1
  }
}

/** 从 [ 之后开始，找匹配的 ] */
function findClosingBracket(content: string, start: number) {
  let depth = 0
  for (let i = start; i < content.length; i++) {
    if (content[i] === '[') depth++
    if (content[i] === ']') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

export default VitePluginAutoOptimizeDepsInclude
