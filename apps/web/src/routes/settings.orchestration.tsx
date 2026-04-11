import { createFileRoute } from "@tanstack/react-router";

import { OrchestrationSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/orchestration")({
  component: OrchestrationSettingsPanel,
});
