import React from "react";

/** Outline paths from Lucide «gavel» — https://lucide.dev/icons/gavel (ISC License). */

type Props = {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
};

export const GavelIcon: React.FC<Props> = ({ size = 56, color = "currentColor", style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
  >
    <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381" />
    <path d="m16 16 6-6" />
    <path d="m21.5 10.5-8-8" />
    <path d="m8 8 6-6" />
    <path d="m8.5 7.5 8 8" />
  </svg>
);
