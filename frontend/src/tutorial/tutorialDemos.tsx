import React from "react";
import { DemoGameStructure } from "./demos/DemoGameStructure";
import { DemoResources } from "./demos/DemoResources";
import { DemoProjectTypes } from "./demos/DemoProjectTypes";
import { DemoDrafting } from "./demos/DemoDrafting";
import { DemoEraTheme } from "./demos/DemoEraTheme";
import { DemoAuction } from "./demos/DemoAuction";
import { DemoTransferAndMessage } from "./demos/DemoTransferAndMessage";
import { DemoReadyChecklist } from "./demos/DemoReadyChecklist";
import type { TutorialDemoKey } from "./demoKeys";

export type { TutorialDemoKey } from "./demoKeys";

export type TutorialDemoComponent = React.FC<{ playerName?: string }>;

export const TUTORIAL_DEMO_BY_KEY: Record<TutorialDemoKey, TutorialDemoComponent> = {
  gameStructure: DemoGameStructure,
  resources: DemoResources,
  projectTypes: DemoProjectTypes,
  drafting: DemoDrafting,
  eraTheme: DemoEraTheme,
  auction: DemoAuction,
  transferAndMessage: DemoTransferAndMessage,
  readyChecklist: DemoReadyChecklist,
};
