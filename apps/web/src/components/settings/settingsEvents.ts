export const SETTINGS_RESTORED_EVENT = "t3code:settings-restored";

export function dispatchSettingsRestoredEvent() {
  window.dispatchEvent(new CustomEvent(SETTINGS_RESTORED_EVENT));
}
