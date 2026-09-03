/* Dev utility: prints every registered API route. Run with `node scripts/list-routes.cjs`. */
require('dotenv/config');
const routes = require('../routes').default;

function walk(stack, prefix) {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push(`${method.toUpperCase().padEnd(6)} ${prefix}${layer.route.path}`);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      out.push(...walk(layer.handle.stack, prefix));
    }
  }
  return out;
}

const list = walk(routes.stack, '/api');
console.log(`${list.length} routes`);
console.log(list.join('\n'));
