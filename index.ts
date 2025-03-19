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
  regex: RegExp
}

function VitePluginAutoOptimizeDepsInclude(option = {} as Option): PluginOption {
  return {
    name: 'update-optimizeDeps-include',
    apply: 'serve',
    enforce: 'pre',
    configureServer: (server) => {
      const originalWrite = process.stdout.write
      const viteConfigPath = server.config.configFile || resolve(process.cwd(), 'vite.config.ts')

      process.stdout.write = function (...args) {
        const r = originalWrite.apply(process.stdout, args)
        // eslint-disable-next-line no-control-regex
        const str = args.at(0).toString().replace(/\x1B\[[0-9;]*m/g, '')
        handle(str)
        return r
      }

      function handle(dependenciesStr: string) {
        const configContent = fs.readFileSync(viteConfigPath, 'utf-8')
        const str = new MagicString(configContent)
        const start = findStartIndexAndIndent(configContent)
        const startIndex = start.index
        const indent = start.indent
        if (!startIndex) return
        const data = dependenciesStr.match(option.regex || /new dependencies optimized:(.*)\n/)
        if (data) {
          const list = data[1].split(',').map(i => i.trim())
          const current = findCurrentList(configContent.slice(startIndex))
          const currentList = current.list
          const endIndex = current.index + startIndex

          // 去重 + 合并 根据长度排序
          const newList = [...new Set([...currentList, ...list])].filter(i => Boolean(i) && !i.startsWith('//')).sort((a, b) => a.length - b.length)
          const newStr = newList.reduce((pre, cur) => {
            return `${pre}${' '.repeat(indent + 2)}'${cur}',\n`
          }, '\n')
          str.update(startIndex, endIndex, newStr + ' '.repeat(indent))
          server.watcher.unwatch(viteConfigPath)
          // 保持文件时间不变 不然会导致vite hrm重启
          const { atime, mtime } = fs.statSync(viteConfigPath)
          fs.writeFileSync(viteConfigPath, str.toString())
          fs.utimesSync(viteConfigPath, atime, mtime)
          server.watcher.add(viteConfigPath)
        }
      }

      function findStartIndexAndIndent(parentStr) {
        const match = parentStr.match(/optimizeDeps:[\s\S]*?include:\s?\[/)
        if (!match) {
          return {
            index: 0,
            indent: 0,
          }
        }
        return {
          index: match.index + match[0].length,
          indent: match[0].split('\n').pop().match(/^\s*/)[0].length,
        }
      }

      function findCurrentList(parentStr) {
        // 找到从0开始碰到的第一个]之前的字符串
        for (let i = 0; i < parentStr.length; i++) {
          if (parentStr[i] === ']') {
            const str = parentStr.slice(0, i)
            return {
              list: str.split(',').map(i => i.replace(/['"]/g, '').trim()),
              index: i,
            }
          }
        }

        return {
          list: [],
          index: 0,
        }
      }
    },
  }
}

export default VitePluginAutoOptimizeDepsInclude
