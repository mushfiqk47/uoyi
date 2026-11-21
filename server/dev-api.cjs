"use strict";

/**
 * Compatibility entry point. The implementation now lives in server/index.cjs, server/router.cjs,
 * server/routes/*, server/services/* and server/lib/*. Vite requires this file and `npm run
 * server` executes it, so both contracts stay stable while the internals are modular.
 */

const api = require("./index.cjs");

module.exports = { handle: api.handle, setApiBase: api.setApiBase };

if (require.main === module) api.start();
