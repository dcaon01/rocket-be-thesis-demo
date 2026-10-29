/**
 * Node resolution entry for the @rocket-be/scoping workspace package.
 * The source package.json intentionally declares no "main": the Nx tsc
 * executor generates the correct one inside dist/package.json (used by
 * nx serve and by the app builds), while consumers resolving through the
 * node_modules workspace symlink (ncc bundles, plain node) land here and
 * are forwarded to the compiled output. Requires `nx build scoping` to
 * have run (the apps' build targets depend on it).
 */
module.exports = require('./dist/src/index.js');
