import React, { useState } from "react";
import { BuffDescText } from "../utils/buffDescEmphasis";
import { uiRem } from "../utils/typography";

interface Props {
  desc: string;
  tagline?: string;
  color: string;
  fontSize?: string;
  /** 收起时最多显示几条（按换行计） */
  collapsedLines?: number;
  defaultOpen?: boolean;
}

/**
 * 道具卡描述：默认只显示前几条，点「展开完整规则」看严谨的完整分点。
 * 完整文案由 BUFF_CARD_DEFS.desc 维护，与服务端 game_data 字符级同步。
 */
export const BuffDescExpandable: React.FC<Props> = ({
  desc,
  tagline,
  color,
  fontSize,
  collapsedLines = 3,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const lines = desc.split("\n").filter((l) => l.trim().length > 0);
  const canExpand = lines.length > collapsedLines;
  const shown = open || !canExpand ? desc : lines.slice(0, collapsedLines).join("\n");

  return (
    <div>
      {tagline && (
        <div
          style={{
            fontWeight: 800,
            color,
            fontSize: fontSize ?? uiRem(0.92),
            lineHeight: 1.45,
            marginBottom: "0.35rem",
          }}
        >
          {tagline}
        </div>
      )}
      <div
        style={{
          fontSize: fontSize ?? uiRem(0.85),
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <BuffDescText text={shown} />
      </div>
      {canExpand && (
        <button
          type="button"
          className="buff-desc-expand-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: uiRem(0.76) }}
        >
          {open ? "收起完整规则" : `展开完整规则（${lines.length} 条）`}
        </button>
      )}
    </div>
  );
};
