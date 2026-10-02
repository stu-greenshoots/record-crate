import { img } from '../api'

interface Props {
  src?: string | null
  title: string
  artist: string
  disc?: boolean
}

/** A record sleeve with the vinyl peeking out from behind it. */
export function Sleeve({ src, title, artist, disc = true }: Props) {
  return (
    <div className="sleeve">
      {disc && <div className="sleeve-disc" />}
      <div className="sleeve-art">
        {src ? (
          <img
            src={img(src)}
            alt={`${artist} — ${title}`}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <BlankSleeve title={title} artist={artist} />
        )}
      </div>
    </div>
  )
}

export function BlankSleeve({ title, artist }: { title: string; artist: string }) {
  return (
    <div className="sleeve-blank">
      <div>
        <div className="a">{artist}</div>
        <div className="t">{title}</div>
      </div>
    </div>
  )
}
