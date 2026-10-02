export function Login({ notice }: { notice?: string | null }) {
  return (
    <div className="login">
      <div className="login-inner">
        <div className="login-disc">
          <div className="sleeve-disc" style={{ transform: 'none', position: 'absolute', inset: 0 }} />
        </div>
        <h1>
          Your collection,
          <br />
          <em>properly filed.</em>
        </h1>
        <p>
          Pull your Discogs collection down onto shelves you control — filed by surname where it
          should be, split into crates that make sense, and laid out so you can flick through it
          like the real thing.
        </p>
        <a className="btn btn-primary" href="/api/auth/login">
          Connect Discogs
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8h10M9 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <div className="login-note">
          {notice === 'denied'
            ? 'Authorisation was declined — try again when you are ready.'
            : notice === 'expired'
              ? 'That sign-in link expired. Give it another go.'
              : 'Opens Discogs to authorise. Everything is stored locally on this machine.'}
        </div>
      </div>
    </div>
  )
}
