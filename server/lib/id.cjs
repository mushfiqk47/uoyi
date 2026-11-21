"use strict";

const crypto = require("node:crypto");

const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

module.exports = { id };
