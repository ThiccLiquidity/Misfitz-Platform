// Runtime resolver for the "@/..." path alias when running compiled tests under node --test.
// tsc type-checks the alias but does not rewrite it in emitted JS, so map it to .test-build/src.
const path = require("path");
const Module = require("module");
const orig = Module._resolveFilename;
const SRC = path.join(__dirname, ".test-build", "src");
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(SRC, request.slice(2));
  return orig.call(this, request, ...rest);
};
