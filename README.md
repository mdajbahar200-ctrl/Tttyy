# PrivateConnect (MVP)
Node.js + Express + SQLite + Socket.IO.
## Run
    npm install
    cp .env.example .env     # set a long random SESSION_SECRET
    npm start                # http://localhost:3000
## Security model
- Passwords & chat-lock PINs: bcrypt (cost 12), never stored raw. Public IDs are usernames/friend codes/random chat UIDs; DB ids never exposed.
- Sessions: httpOnly, SameSite=Strict cookies (Secure in production), regenerated on login. CSRF: SameSite + required X-Requested-With header.
- Every chat route runs chatFor(): membership + accepted friendship + no block + per-session unlock. Unlock state is per-chat in the session, separate from login.
- Rate limits on login/signup/unlock; helmet headers; parameterised SQL; UI uses textContent only (no XSS).
- Sockets reuse the session and only join the user's own room; messages are sent via authorised REST then pushed.
- Deploy behind HTTPS (NODE_ENV=production, trust proxy is on).
## Not yet built (next steps)
Admin panel (users.is_admin + reports table exist), password reset (needs email service), invite links, read-receipt/online privacy toggles beyond requests/search,
media/voice uploads (needs private object storage + signed URLs), notifications panel, avatars, multi-device session list.
