import { useEffect, useState } from 'react'

interface ToastItem {
  id: number
  text: string
  undo?: () => void
}

let push: ((t: ToastItem) => void) | null = null
let seq = 0

/** A short confirmation at the bottom of the screen, with an optional Undo. */
export function toast(text: string, opts: { undo?: () => void } = {}) {
  push?.({ id: ++seq, text, undo: opts.undo })
  navigator.vibrate?.(12)
}

export function Toaster() {
  const [item, setItem] = useState<ToastItem | null>(null)
  useEffect(() => {
    push = setItem
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
      {item.undo && (
        <button
          type="button"
          onClick={() => {
            item.undo?.()
            setItem(null)
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
