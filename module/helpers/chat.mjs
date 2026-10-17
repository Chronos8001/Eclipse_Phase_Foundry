/**
 * Chat message visibility on both v13 (roll modes: core.rollMode, applyRollMode)
 * and v14 (message modes: core.messageMode, CONFIG.ChatMessage.modes, applyMode).
 */

const usesMessageModes = () => !!CONFIG.ChatMessage?.modes;

/** Visibility choices for a select: [{ value, label }]. The v14 in-character mode is not a visibility. */
export function messageModeChoices() {
  const modes = usesMessageModes() ? CONFIG.ChatMessage.modes : CONFIG.Dice.rollModes;
  return Object.entries(modes)
    .filter(([value]) => value !== "ic")
    .map(([value, mode]) => ({ value, label: (typeof mode === "string") ? mode : mode.label }));
}

/** The user's current visibility preference. */
export function defaultMessageMode() {
  const v14 = usesMessageModes();
  try {
    const mode = game.settings.get("core", v14 ? "messageMode" : "rollMode");
    if ( mode ) return mode;
  } catch {}
  return v14 ? "public" : "publicroll";
}

/**
 * Create a chat message with the given visibility.
 * @param {object} data      ChatMessage data
 * @param {string} [mode]    A message (v14) or roll (v13) mode; defaults to the user's preference
 */
export function createMessage(data, mode) {
  const cls = ChatMessage.implementation;
  mode ||= defaultMessageMode();
  if ( usesMessageModes() ) return cls.create(cls.applyMode(data, mode), { messageMode: mode });
  return cls.create(cls.applyRollMode(data, mode), { rollMode: mode });
}
