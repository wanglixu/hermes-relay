'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type ModelsPayload, type Skill } from '@/lib/api'
import { notify } from '@/components/ui/toast'

/** 页面顶部那点全局配置：当前模型、可选模型清单、技能清单。
 *  从 app/page.tsx 拆出来（2026-10-19），那边一个组件里塞了十几个 useState；
 *  这三样是「load 一次、随时可刷新」的同一类东西，跟聊天流程没有耦合。
 *  失败一律 notify：以前是空 catch，清单取不到时界面只是「没有反应」。
 */
export function useRelayConfig() {
  const [model, setModel] = useState('')
  const [models, setModels] = useState<ModelsPayload | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])

  const loadModels = useCallback(() => {
    api
      .models()
      .then(setModels)
      .catch(() => notify('模型清单没取到，右下角的模型选择先别动'))
  }, [])

  const loadSkills = useCallback(() => {
    api
      .skills()
      .then((r) => setSkills(r.skills))
      .catch(() => notify('技能清单没取到，输入框的 / 菜单可能是空的'))
  }, [])

  const loadConfig = useCallback(() => {
    api
      .config()
      .then((c) => setModel(c.model))
      .catch(() => notify('读取当前模型配置失败'))
  }, [])

  useEffect(() => {
    loadConfig()
    loadModels()
    loadSkills()
  }, [loadConfig, loadModels, loadSkills])

  // 窗口切回前台或获得焦点时同步一次（模型 / 技能可能在别处被改过）
  useEffect(() => {
    const onFocus = () => {
      loadSkills()
      loadModels()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadSkills, loadModels])

  return { model, models, skills, loadModels, loadSkills, loadConfig }
}
