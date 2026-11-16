/** Marca do Twelvefold: a flor sobre o quadrado ameixa. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="30" fill="#5B2140" />
      <g transform="translate(18 18) scale(0.64)">
        <g fill="#FFB3D9"><circle cx="82.00" cy="50.00" r="18"/><circle cx="72.63" cy="72.63" r="18"/><circle cx="50.00" cy="82.00" r="18"/><circle cx="27.37" cy="72.63" r="18"/><circle cx="18.00" cy="50.00" r="18"/><circle cx="27.37" cy="27.37" r="18"/><circle cx="50.00" cy="18.00" r="18"/><circle cx="72.63" cy="27.37" r="18"/><circle cx="50" cy="50" r="36"/></g><circle cx="50" cy="50" r="15" fill="#5B2140"/><circle cx="50" cy="50" r="7.5" fill="#D2F54A"/>
      </g>
    </svg>
  )
}
