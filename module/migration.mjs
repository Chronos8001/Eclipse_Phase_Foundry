import { SYSTEM_ID } from "./config.mjs";

/**
 * World migrations. The data models already migrate old data when it is loaded (migrateData); a migration writes the
 * result back to the database, once per world, so that old documents no longer depend on it.
 *
 * Each step has a version number; the world remembers the last one done (the hidden "migrationVersion" setting).
 * A step lists the item types whose data it rewrites, or a function giving the update of an item's source.
 */
const MIGRATIONS = [
  // 0.1: sleights stored range, duration and strain modifier as free text (SleightData.migrateData)
  { version: 1, itemTypes: ["sleight"] }
];
export const MIGRATION_VERSION = Math.max(...MIGRATIONS.map(m => m.version));

const L = (key, data) => game.i18n.format(`EP1E.Migration.${key}`, data ?? {});

export function registerMigrationSetting() {
  game.settings.register(SYSTEM_ID, "migrationVersion", {
    scope: "world", config: false, type: Number, default: 0
  });
}

/** Run the migrations this world has not done yet (by the active GM). */
export async function migrateWorld() {
  if ( !game.user.isActiveGM ) return;
  const done = game.settings.get(SYSTEM_ID, "migrationVersion");
  if ( done >= MIGRATION_VERSION ) return;
  // A new world has nothing to migrate
  if ( !done && !game.actors.size && !game.items.size ) return game.settings.set(SYSTEM_ID, "migrationVersion", MIGRATION_VERSION);

  const steps = MIGRATIONS.filter(m => m.version > done);
  ui.notifications.info(L("start", { version: game.system.version }), { permanent: true });
  let failures = 0;
  const attempt = async (doc, fn) => {
    try {
      await fn();
    } catch ( err ) {
      failures++;
      console.error(`${SYSTEM_ID} | Migration failed for ${doc.uuid}`, err);
    }
  };

  for ( const item of game.items ) {
    const update = itemUpdate(item, steps);
    if ( update ) await attempt(item, () => item.update(update, { diff: false, recursive: false }));
  }
  const actors = [...game.actors];
  // Unlinked tokens keep their own copy of the actor's items
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) if ( !token.actorLink && token.actor ) actors.push(token.actor);
  }
  for ( const actor of actors ) {
    const updates = actor.items.map(i => itemUpdate(i, steps)).filter(u => u);
    if ( updates.length ) await attempt(actor, () => actor.updateEmbeddedDocuments("Item", updates, { diff: false, recursive: false }));
  }
  // World compendiums that are not locked
  for ( const pack of game.packs ) {
    if ( (pack.metadata.packageType !== "world") || pack.locked || !["Actor", "Item"].includes(pack.documentName) ) continue;
    for ( const doc of await pack.getDocuments() ) {
      if ( pack.documentName === "Item" ) {
        const update = itemUpdate(doc, steps);
        if ( update ) await attempt(doc, () => doc.update(update, { diff: false, recursive: false }));
      } else {
        const updates = doc.items.map(i => itemUpdate(i, steps)).filter(u => u);
        if ( updates.length ) await attempt(doc, () => doc.updateEmbeddedDocuments("Item", updates, { diff: false, recursive: false }));
      }
    }
  }

  await game.settings.set(SYSTEM_ID, "migrationVersion", MIGRATION_VERSION);
  if ( failures ) ui.notifications.warn(L("failed", { count: failures }), { permanent: true });
  else ui.notifications.info(L("done", { version: game.system.version }), { permanent: true });
}

/**
 * The update writing back an item's migrated data, or null. The loaded source is already migrated, so the whole
 * system data is written (diff: false, recursive: false).
 */
function itemUpdate(item, steps) {
  const step = steps.find(s => s.itemTypes?.includes(item.type));
  if ( !step ) return null;
  return { _id: item.id, system: item.toObject().system };
}
