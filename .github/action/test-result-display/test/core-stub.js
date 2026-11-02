// Minimal @actions/core stub for unit testing without installed dependencies.
// Only the methods used by index.js are provided as no-ops.
module.exports = {
  info: () => {},
  warning: () => {},
  error: () => {},
  setOutput: () => {},
  setFailed: () => {},
  getInput: () => "",
};
