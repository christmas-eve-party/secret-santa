// The box everyone's name goes into. It gets taped shut once sign-ups close.
// `bump` counts names dropped in; each change replays a little bounce.
export default function DrawBox({ sealed = false, bump = 0 }) {
  return (
    <svg
      key={bump}
      className={bump ? 'draw-box draw-box--bump' : 'draw-box'}
      viewBox="0 0 300 160"
      aria-hidden="true"
    >
      {/* lid, seen from a little above, with the slot for names */}
      <path d="M40 20 H260 L288 50 H12 Z" fill="#a32531" />
      <rect x="94" y="30" width="112" height="11" rx="5.5" fill="#3a0b12" />
      {sealed && (
        <rect x="80" y="25" width="140" height="21" rx="2" fill="#efe0bd" opacity="0.95" transform="rotate(-4 150 35)" />
      )}
      <rect x="8" y="50" width="284" height="26" rx="4" fill="#c12e3a" />

      {/* box */}
      <path d="M22 76 H278 V150 Q278 156 272 156 H28 Q22 156 22 150 Z" fill="#ad2733" />
      <rect x="22" y="76" width="256" height="7" fill="#8c1b26" />

      {/* ribbon and bow */}
      <rect x="240" y="50" width="22" height="106" fill="#e3b04b" />
      <rect x="240" y="76" width="22" height="7" fill="#c4922f" />
      <path d="M251 50 C 232 24 212 30 223 45 C 229 52 240 52 251 50 Z" fill="#e3b04b" />
      <path d="M251 50 C 270 24 290 30 279 45 C 273 52 262 52 251 50 Z" fill="#e3b04b" />
      <circle cx="251" cy="49" r="6" fill="#c4922f" />
    </svg>
  );
}
