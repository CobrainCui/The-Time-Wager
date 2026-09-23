import React, { useState } from "react";
import { uiRem } from "../../utils/typography";

const ITEMS = [
  { id: "energy", label: "每轮精力会重置，鼓励花完" },
  { id: "long", label: "长期项目断供（<3）会放弃前期投入" },
  { id: "risk", label: "风险项目超上限会倒扣历史收益" },
  { id: "seat", label: "财富少者优先选座，影响长期占位" },
  { id: "era", label: "投资契合时代主题可获额外奖励" },
  { id: "auction", label: "拍卖会用财富竞拍 Buff 卡" },
  { id: "transfer", label: "右侧一对一对话框可转账；不填金额并留言即私信" },
];

export const DemoReadyChecklist: React.FC = () => {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const allDone = ITEMS.every((i) => checked[i.id]);

  const toggle = (id: string) => setChecked((c) => ({ ...c, [id]: !c[id] }));

  return (
    <div>
      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
        勾选表示你已理解（仅本地记录）：
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {ITEMS.map((item) => (
          <li key={item.id}>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.65rem",
                padding: "0.65rem 0.75rem",
                borderRadius: "0.5rem",
                border: `1px solid ${checked[item.id] ? "rgba(16,185,129,0.35)" : "var(--color-border)"}`,
                background: checked[item.id] ? "rgba(16,185,129,0.08)" : "transparent",
                cursor: "pointer",
                fontSize: uiRem(0.9),
                color: "var(--color-text-secondary)",
              }}
            >
              <input type="checkbox" checked={!!checked[item.id]} onChange={() => toggle(item.id)} style={{ marginTop: "0.2rem" }} />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
      {allDone && (
        <div
          className="animate-fadeIn"
          style={{
            marginTop: "1rem",
            padding: "1rem",
            borderRadius: "0.75rem",
            background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(168,85,247,0.12))",
            border: "1px solid rgba(168,85,247,0.3)",
            textAlign: "center",
            fontWeight: 700,
            color: "#c4b5fd",
          }}
        >
          🎉 准备就绪！祝你在光阴的博弈中此生无悔。
        </div>
      )}
    </div>
  );
};
