// RETIRED: LegalWhat now requires a verified subscription or explicit administrator override.
// Kept as a compatibility export so old tooling cannot accidentally re-enable universal access.

export async function runFreeAccessMigration() {
  console.warn('[Migration] Legacy free-access migration is retired; no user access state was changed');
  return {
    success: true,
    message: 'Legacy free-access migration retired; no users changed',
    usersUpdated: 0,
    retired: true,
  };
}

export default runFreeAccessMigration;
