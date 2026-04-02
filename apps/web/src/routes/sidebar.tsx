import { createFileRoute } from "@tanstack/react-router";

import { SidebarWindow } from "../components/SidebarWindow";

export const Route = createFileRoute("/sidebar")({
  component: SidebarWindow,
});
