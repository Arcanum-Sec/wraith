// Module registry. Each module is a self-contained {id,label,blurb,html,css,script}.
// hook.js renders html+css inside a shadow DOM and runs script (if any) there.
// To add a module: drop a file here and require it below. Nothing else to wire.

const linkedin = require('./linkedin');
const facebook = require('./facebook');
const microsoft = require('./microsoft');
const portscan = require('./portscan');
const capture = require('./capture');

const all = [linkedin, facebook, microsoft, portscan, capture];
const byId = new Map(all.map(m => [m.id, m]));

module.exports = {
  list: () => all,
  get: id => byId.get(id)
};
