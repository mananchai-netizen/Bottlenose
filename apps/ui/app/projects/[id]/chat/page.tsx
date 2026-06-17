'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport } from 'ai'
import type { ProjectConfig } from '@/lib/types'

export default function ProjectChatPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const [project, setProject] = useState<ProjectConfig | null>(null)
  const [loadingProject, setLoadingProject] = useState(true)
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new TextStreamChatTransport({
      api: '/api/chat',
      body: { projectId },
    }),
  })

  useEffect(() => {
    void fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((p: ProjectConfig) => setProject(p))
      .finally(() => setLoadingProject(false))
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || status === 'streaming') return
    void sendMessage({ text })
    setText('')
  }

  const isStreaming = status === 'streaming' || status === 'submitted'

  if (loadingProject) return <p className="text-zinc-500 text-sm">Loading...</p>
  if (!project) return <p className="text-red-400 text-sm">Project not found.</p>

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-cyan-400">{project.project_name}</h1>
          <p className="text-xs text-zinc-500">
            {project.github_repo ?? 'No repo connected'}
            {!project.github_token && project.github_repo && (
              <span className="ml-2 text-yellow-500">⚠ No GitHub token — repo context unavailable</span>
            )}
          </p>
        </div>
        <button
          onClick={() => router.push('/projects')}
          className="text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← Back
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 text-sm mt-12">
            <p className="text-2xl mb-2">💬</p>
            <p>คุยกับ AI เกี่ยวกับโปรเจคนี้ได้เลย</p>
            <p className="text-xs mt-1 text-zinc-700">เช่น "อธิบาย architecture" หรือ "อยากเพิ่ม feature X"</p>
          </div>
        )}

        {messages.map((m) => {
          const content = m.parts
            .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('')
          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-cyan-600 text-white rounded-br-sm'
                  : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
              }`}>
                {m.role === 'assistant' && <p className="text-xs text-zinc-500 mb-1">Bottlenose AI</p>}
                {content}
              </div>
            </div>
          )
        })}

        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-3">
              <span className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            </div>
          </div>
        )}

        {error && <p className="text-red-400 text-xs text-center">{error.message}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="พิมพ์ข้อความ..."
          disabled={isStreaming}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-600 disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={isStreaming || text.trim().length === 0}
          className="px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  )
}
