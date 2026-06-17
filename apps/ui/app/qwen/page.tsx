'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

export default function QwenPage() {
  const [system, setSystem] = useState('You are a helpful assistant.')
  const [showSystem, setShowSystem] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || loading) return

    const userText = prompt.trim()
    setPrompt('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', text: userText }])
    setLoading(true)

    try {
      const res = await fetch('/api/qwen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: system.trim() || undefined, user: userText }),
      })
      const data = (await res.json()) as { text?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMessages((prev) => [...prev, { role: 'assistant', text: data.text ?? '' }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setMessages((prev) => prev.slice(0, -1))
      setPrompt(userText)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-cyan-400">Qwen Chat</h1>
          <p className="text-xs text-zinc-500">RunPod vLLM — OpenAI-compatible inference</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSystem((v) => !v)}
            className="text-xs text-zinc-500 hover:text-white transition-colors px-2 py-1 rounded hover:bg-zinc-800"
          >
            {showSystem ? 'Hide system prompt' : 'System prompt'}
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setError(null) }}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* System prompt editor */}
      {showSystem && (
        <div className="mb-4">
          <label className="text-xs text-zinc-500 mb-1 block">System Prompt</label>
          <textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-600 transition-colors resize-none"
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && !loading && (
          <div className="text-center text-zinc-600 text-sm mt-16">
            <p className="text-3xl mb-3">🤖</p>
            <p>ส่ง prompt ไปหา Qwen บน RunPod ได้เลย</p>
            <p className="text-xs mt-1 text-zinc-700">Shift+Enter ขึ้นบรรทัดใหม่ / Enter ส่ง</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
              m.role === 'user'
                ? 'bg-cyan-600 text-white rounded-br-sm'
                : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
            }`}>
              {m.role === 'assistant' && (
                <p className="text-xs text-zinc-500 mb-1">Qwen</p>
              )}
              {m.text}
            </div>
          </div>
        ))}

        {loading && (
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

        {error && (
          <p className="text-red-400 text-xs text-center bg-red-950/30 rounded-lg px-4 py-2">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={(e) => { void submit(e) }} className="mt-4 flex gap-2 items-end">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="พิมพ์ prompt... (Enter ส่ง / Shift+Enter ขึ้นบรรทัดใหม่)"
          disabled={loading}
          rows={3}
          className="flex-1 bg-white border border-zinc-300 rounded-xl px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-cyan-600 disabled:opacity-50 transition-colors resize-none"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors self-end"
        >
          Send
        </button>
      </form>
    </div>
  )
}
