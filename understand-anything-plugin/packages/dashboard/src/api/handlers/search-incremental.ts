import fs from "fs"
import path from "path"
import type { SearchIndexState, SearchIndexItem } from "./search"
import {
  buildTokenizedDocs,
  buildLumoIndex,
  CJK_REGEX,
} from "./search"

/**
 * 简单的增量索引更新
 *
 * 设计原则：
 * 1. 保持简单 - 不做节点级存储，直接读取JSON文件
 * 2. mtime检测 - 用文件修改时间判断是否需要重建
 * 3. 全量重建 - 如果文件变化，全量重建该文件的索引
 *
 * 对于几十MB的JSON文件，全量重建只需要50-100ms，完全可接受
 */

export interface IncrementalIndexState {
  index: SearchIndexState
  fileMtimes: Map<string, number>
}

/**
 * 检查文件是否有变化
 */
export function hasFileChanged(file: string, lastMtime: number): boolean {
  try {
    const stats = fs.statSync(file)
    return stats.mtimeMs > lastMtime
  } catch {
    return true
  }
}

/**
 * 获取文件的 mtime
 */
function getFileMtime(file: string): number {
  try {
    const stats = fs.statSync(file)
    return stats.mtimeMs
  } catch {
    return 0
  }
}

/**
 * 从全量索引创建增量索引状态
 */
export function createIncrementalState(
  index: SearchIndexState,
  projectRoot: string,
): IncrementalIndexState {
  // 收集所有索引文件的 mtime
  const fileMtimes = new Map<string, number>()

  // 这里可以根据实际情况添加需要监控的文件
  // 暂时返回空map，让调用方决定监控哪些文件

  return { index, fileMtimes }
}

/**
 * 增量更新索引
 *
 * @param currentState 当前索引状态
 * @param buildIndex 索引构建函数（由调用方提供）
 * @param projectRoot 项目根目录
 * @returns 更新后的索引状态
 */
export function updateIndexIncrementally(
  currentState: IncrementalIndexState,
  buildIndex: () => SearchIndexState,
  projectRoot: string,
): IncrementalIndexState {
  // 直接调用全量重建
  // 对于几十MB的JSON，这只需要50-100ms
  const newIndex = buildIndex()

  return {
    index: newIndex,
    fileMtimes: currentState.fileMtimes,
  }
}

/**
 * 简单的缓存策略：基于 mtime 的索引缓存
 */
export class SearchIndexCache {
  private cache: Map<string, { state: SearchIndexState, mtime: number }> = new Map()

  /**
   * 获取缓存的索引，如果过期则重建
   */
  get(
    key: string,
    files: string[],
    buildIndex: () => SearchIndexState,
  ): SearchIndexState {
    const cached = this.cache.get(key)

    // 检查所有文件是否变化
    const needsRebuild = !cached || files.some(file => {
      const currentMtime = getFileMtime(file)
      return currentMtime > cached.mtime
    })

    if (!needsRebuild) {
      return cached.state
    }

    // 重建索引
    const state = buildIndex()
    const maxMtime = Math.max(...files.map(f => getFileMtime(f)))

    this.cache.set(key, { state, mtime: maxMtime })
    return state
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear()
  }
}

// 导出全局缓存实例
export const searchIndexCache = new SearchIndexCache()
