import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";

interface Props {
  src: string;
  alt: string;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const PersonaPortraitImage: React.FC<Props> = ({
  src,
  alt,
  borderColor = "rgba(255,255,255,0.12)",
  style,
}) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.04)",
          color: "var(--color-text-muted)",
          fontSize: uiRem(0.75),
          textAlign: "center",
          padding: "0.75rem",
          ...style,
        }}
      >
        立绘加载失败
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        border: `1px solid ${borderColor}`,
        ...style,
      }}
      onError={() => setFailed(true)}
    />
  );
};
