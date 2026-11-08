import { useEffect, useState } from 'react'

interface ToastItem {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

let push: ((t: ToastItem) => void) | null = null
let early: ToastItem | null = null
let seq = 0

/**
 * A short note at the bottom of the screen, with an optional Undo or other action.
 * It buzzes to confirm something you did; an action offered unprompted doesn't.
 */
export function toast(text: string, opts: { undo?: () => void; action?: ToastItem['action'] } = {}) {
  const item = { id: ++seq, text, action: opts.action ?? (opts.undo && { label: 'Undo', run: opts.undo }) }
  if (push) push(item)
  else early = item
  if (!opts.action) navigator.vibrate?.(12)
}

export function Toaster() {
  const [item, setItem] = useState<ToastItem | null>(null)
  useEffect(() => {
    push = setItem
    if (early) setItem(early)
    early = null
    return () => {
      push = null
    }
  }, [])
  useEffect(() => {
    if (!item) return
    const t = setTimeout(() => setItem((cur) => (cur?.id === item.id ? null : cur)), 3800)
    return () => clearTimeout(t)
  }, [item])
  if (!item) return null
  return (
    <div className="toast" role="status" key={item.id}>
      <span>{item.text}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.run()
            setItem(null)
          }}
        >
          {item.action.label}
        </button>
      )}
    </div>
  )
}
