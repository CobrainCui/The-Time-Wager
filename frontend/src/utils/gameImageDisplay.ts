import { BACKEND_URL } from "../socket";

export type ImageSource = "custom" | "default";

export type ResolvedImage = {
  src: string;
  source: ImageSource;
};

export function getProjectImageDisplay(
  projectId: number,
  projectName: string,
  projectImages: Record<number, number>,
  /** 单卡场景（如 ProjectCard）可只传当前 version，避免构造临时对象 */
  singleVersion?: number,
): ResolvedImage {
  const version = singleVersion ?? projectImages[projectId];
  if (version != null && version > 0) {
    return {
      src: `${BACKEND_URL}/uploads/${projectId}.jpg?v=${version}`,
      source: "custom",
    };
  }
  return {
    src: `/images/projects/${projectName}.jpg?v=final2`,
    source: "default",
  };
}

export function getEraImageDisplay(eraName: string, eraImages: Record<string, number>): ResolvedImage {
  const version = eraImages[eraName];
  if (version != null && version > 0) {
    return {
      src: `${BACKEND_URL}/uploads_eras/${eraName}.jpg?v=${version}`,
      source: "custom",
    };
  }
  return {
    src: `/images/eras/${eraName}.jpg?v=final1`,
    source: "default",
  };
}

export function getBuffCustomImageSrc(cardId: string, buffImages: Record<string, number>): string | null {
  const v = buffImages[cardId];
  if (v == null || v <= 0) return null;
  return `${BACKEND_URL}/uploads_buffs/${cardId}.jpg?v=${v}`;
}

export function hasBuffCustomImage(cardId: string, buffImages: Record<string, number>): boolean {
  const v = buffImages[cardId];
  return v != null && v > 0;
}
