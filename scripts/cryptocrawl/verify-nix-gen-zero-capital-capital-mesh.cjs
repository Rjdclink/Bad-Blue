// Included by Dockerfile's existing verify-nix-gen-*.cjs release gate.
// Keep these structural acceptance checks in the normal build without creating
// a parallel CI/build authority.
require('./verify-zero-initial-capital-runtime-guards.cjs');
require('./verify-expanded-capability-mesh.cjs');
require('./verify-external-capital-capabilities.cjs');
require('./verify-cryptara-network-rainbow-capital.cjs');

console.log('nix-gen zero-capital/capital-mesh meta-gate: structural checks passed');
