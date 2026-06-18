'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProjectConfig } from '@/lib/types'

interface PlanJobState {
  status: 'pending' | 'running' | 'done' | 'error'
  step: string
  message: string
  result?: unknown
  error?: string
  createdAt: string
  updatedAt?: string
}

type RunState = 'idle' | 'loading' | 'done' | 'error'

const STEP_LABEL: Record<string, string> = {
  starting: 'กำลังเริ่มต้น...',
  planning: 'กำลังอ่านไฟล์และแตก task...',
  done: 'เสร็จสิ้น',
  error: 'เกิดข้อผิดพลาด',
}

export default function PlanPage() {
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [runState, setRunState] = useState<RunState>('idle')
  const [jobState, setJobState] = useState<PlanJobState | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: ProjectConfig[]) => setProjects(data.filter((p) => p.google_drive_folder_id)))
      .catch(() => setProjects([]))
  }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const startPolling = (jobId: string) => {
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000)

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/plan-tasks/status/${jobId}`)
        if (!res.ok) return
        const state = (await res.json()) as PlanJobState
        setJobState(state)

        if (state.status === 'done') {
          stopPolling()
          setRunState('done')
        } else if (state.status === 'error') {
          stopPolling()
          setRunState('error')
        }
      } catch { /* poll silently */ }
    }, 3000)
  }

  useEffect(() => () => stopPolling(), [])

  const runPlan = async () => {
    stopPolling()
    setRunState('loading')
    setJobState(null)
    setElapsedSec(0)

    try {
      const res = await fetch('/api/plan-tasks', { method: 'POST' })
      const data = (await res.json()) as { jobId?: string; error?: string }

      if (!res.ok || data.error) {
        setJobState({ status: 'error', step: 'error', message: data.error ?? `HTTP ${res.status}`, createdAt: new Date().toISOString() })
        setRunState('error')
        return
      }

      if (data.jobId) startPolling(data.jobId)
    } catch (e) {
      setJobState({ status: 'error', step: 'error', message: e instanceof Error ? e.message : 'Unknown error', createdAt: new Date().toISOString() })
      setRunState('error')
    }
  }

  const hasProjects = projects.length > 0
  const result = jobState?.result as { total_created?: number; summary?: Array<{ project: string; tasks: string[]; moved?: string[] }> } | undefined

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cyan-600 dark:text-cyan-400">Plan Tasks from Drive</h1>
        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
          อ่าน requirement จาก Google Drive แล้วให้ AI แตก task ขึ้น Notion
        </p>
      </div>

      {/* Projects */}
      <div className="mb-6">
        <p className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wide mb-2">
          Projects with Google Drive
        </p>
        {projects.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-5 py-4 text-sm text-gray-500 dark:text-zinc-500">
            ไม่มี project ที่ตั้ง <span className="font-mono text-xs">google_drive_folder_id</span> ไว้ —{' '}
            <a href="/projects" className="text-cyan-600 dark:text-cyan-400 hover:underline">ไปตั้งค่า Projects</a>
          </div>
        ) : (
          <div className="grid gap-2">
            {projects.map((p) => (
              <div key={p.project_id} className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-5 py-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-gray-900 dark:text-zinc-100">{p.project_name}</p>
                  <p className="text-xs text-gray-400 dark:text-zinc-600 font-mono mt-0.5 truncate">{p.google_drive_folder_id}</p>
                </div>
                <span className="shrink-0 ml-4 text-xs px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">Drive linked</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => void runPlan()}
          disabled={runState === 'loading' || !hasProjects}
          className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          {runState === 'loading' ? `Planning… ${elapsedSec}s` : 'Plan Tasks from Drive'}
        </button>
        {runState === 'loading' && (
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            {jobState ? (STEP_LABEL[jobState.step] ?? jobState.message) : 'กำลังเริ่มต้น...'}
          </span>
        )}
      </div>

      {/* Error */}
      {runState === 'error' && jobState && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {jobState.error ?? jobState.message}
        </div>
      )}

      {/* Result */}
      {runState === 'done' && result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-200 dark:border-green-900/70 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-700 dark:text-green-400">
            สร้างสำเร็จ {result.total_created ?? 0} task(s) บน Notion
          </div>

          {(result.summary ?? []).map((s, i) => {
            const errors = s.tasks.filter((t) => t.startsWith('ERROR'))
            const created = s.tasks.filter((t) => !t.startsWith('ERROR'))
            return (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 px-5 py-4">
                <p className="text-xs text-gray-400 dark:text-zinc-500 font-mono mb-3 truncate">DB: {s.project}</p>
                {created.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {created.map((t, j) => (
                      <li key={j} className="text-xs text-gray-700 dark:text-zinc-300 flex gap-2">
                        <span className="text-green-500 shrink-0">✓</span><span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {errors.length > 0 && (
                  <ul className="space-y-1">
                    {errors.map((t, j) => (
                      <li key={j} className="text-xs text-red-500 dark:text-red-400 flex gap-2">
                        <span className="shrink-0">✗</span><span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {(s.moved?.length ?? 0) > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                    <p className="text-xs text-gray-400 dark:text-zinc-500 mb-1">Moved to backup</p>
                    <ul className="space-y-0.5">
                      {s.moved!.map((name, j) => (
                        <li key={j} className="text-xs text-amber-600 dark:text-amber-400 flex gap-2">
                          <span className="shrink-0">→</span><span className="font-mono">{name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
