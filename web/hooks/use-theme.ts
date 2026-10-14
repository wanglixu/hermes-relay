'use client'

import { useCallback, useEffect } from 'react'

/** 2026-10-09 起只有一套「暖纸」配色（深色 / 冷纸两套已删除）。
 *  仍然导出数组和 setter，是为了设置页那边的调用形状不用改；
 *  现在设置里只会出现这一项，点它也不会有变化。 */
export const THEMES = ['warm'] as const
export type Theme = (typeof THEMES)[number]

/** 色板就是那套 token 里的几个关键色，用来在设置里预览。 */
export const THEME_META: Record<Theme, { label: string; note: string; swatches: string[] }> = {
  warm: {
    label: '暖纸',
    note: '米白棉纸配赭石印泥，像信笺。长时间看也不刺眼。',
    swatches: ['#fbfaf7', '#f7f5f0', '#efece4', '#8c5a3b'],
  },
}

const LEGACY_KEY = 'relay-theme'

export function useTheme() {
  // 以前切主题时会往 localStorage 写 relay-theme，现在没主题可切了，顺手清掉遗留值
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* 隐私模式下读不到就算了 */
    }
  }, [])

  const choose = useCallback((_t: Theme) => {
    /* 只有一套配色，不需要做任何事 */
  }, [])

  return { theme: 'warm' as Theme, choose }
}
