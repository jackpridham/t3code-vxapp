export const CHANGES_PANEL_WIDTH_STORAGE_KEY = "chat_changes_panel_width";
export const CHANGES_PANEL_DEFAULT_WIDTH = "clamp(14rem,24vw,22rem)";
export const CHANGES_PANEL_MIN_WIDTH = 13 * 16;
export const CHANGES_PANEL_MIN_MAIN_CONTENT_WIDTH = 40 * 16;

export function resolveEffectiveChangesPanelOpen(input: {
  changesPanelOpen: boolean;
  initializedFromSettings: boolean;
  showByDefault: boolean;
}): boolean {
  return input.initializedFromSettings ? input.changesPanelOpen : input.showByDefault;
}
