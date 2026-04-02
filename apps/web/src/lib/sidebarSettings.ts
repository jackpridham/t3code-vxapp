import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";

export const SIDEBAR_PROJECT_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual (sticky)",
};

export const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
