interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconDoor = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M3 21h18" />
    <path d="M6 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17" />
    <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLasso = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4.5 10.5c0-3.6 3.4-6.5 7.5-6.5s7.5 2.9 7.5 6.5-3.4 6.5-7.5 6.5c-1.2 0-2.4-.2-3.4-.6" />
    <path d="M8.6 16.4c-.9 1-1.6 1.9-1.6 2.9a2 2 0 0 0 4 0" />
    <circle cx="5.2" cy="19.3" r="1.7" />
  </svg>
);

export const IconCrosshair = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export const IconLayers = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
    <path d="m3 12.5 9 4.5 9-4.5" />
    <path d="m3 17 9 4.5 9-4.5" />
  </svg>
);

export const IconList = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);

export const IconPlus = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconUndo = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10H9" />
  </svg>
);

export const IconCheck = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconX = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconTrash = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconTarget = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className} aria-hidden="true">
    <path d="M20.5 12a8.5 8.5 0 1 1-8.5-8.5" />
    <path d="M12 12 20 4" />
    <path d="M15.5 4.5 20 4l-.5 4.5" />
  </svg>
);
