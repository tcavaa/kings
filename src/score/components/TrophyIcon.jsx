export default function TrophyIcon({ size = 20, color = '#d4a017', className = '' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" className={className}
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {/* Crown — 5 points */}
      <path
        d="M8.5 5.5 L9 2.5 L10.5 4.2 L12 1.8 L13.5 4.2 L15 2.5 L15.5 5.5 Z"
        fill={color} stroke={color} strokeWidth="0.3" strokeLinejoin="round"
      />
      {/* Crown band */}
      <rect x="8" y="5.3" width="8" height="1.2" rx="0.4" fill={color} />

      {/* Cup body — slightly barrel-shaped */}
      <path
        d="M8 6.5 C7.6 8 7.6 10.2 8.2 11.4 Q9.2 13 12 13 Q14.8 13 15.8 11.4 C16.4 10.2 16.4 8 16 6.5 Z"
        fill={`${color}28`} stroke={color} strokeWidth="1.3"
      />

      {/* Left handle — wide ornate loop */}
      <path
        d="M8.2 8 C6.5 7.6 5 8.5 5 10 C5 11.5 6.5 12.4 8.2 12"
        fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round"
      />
      {/* Right handle */}
      <path
        d="M15.8 8 C17.5 7.6 19 8.5 19 10 C19 11.5 17.5 12.4 15.8 12"
        fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round"
      />

      {/* Neck / stem */}
      <path
        d="M9.8 13 L10.2 15.5 L13.8 15.5 L14.2 13"
        fill={`${color}28`} stroke={color} strokeWidth="1"  strokeLinejoin="round"
      />

      {/* Base step 1 (narrowest) */}
      <rect x="9" y="15.5" width="6" height="1.3" rx="0.35" fill={color} opacity="0.85" />
      {/* Base step 2 */}
      <rect x="7" y="16.8" width="10" height="1.3" rx="0.35" fill={color} opacity="0.9" />
      {/* Base step 3 (widest pedestal) */}
      <rect x="5" y="18.1" width="14" height="2" rx="0.5" fill={color} />
    </svg>
  )
}
