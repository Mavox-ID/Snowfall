import { pathToFileURL } from 'node:url';
import { resolve as pres } from 'node:path';
const mocks = pathToFileURL(pres(import.meta.dirname, 'mocks.mjs')).href;

export async function resolve(spec, ctx, next) {
    if (spec.startsWith('gi://') || spec.startsWith('resource://')) return { url: 'mock:' + spec, shortCircuit: true };
    return next(spec, ctx);
}
export async function load(url, ctx, next) {
    if (!url.startsWith('mock:')) return next(url, ctx);
    const spec = url.slice(5);
    const gi = spec.match(/^gi:\/\/(\w+)/);
    let src;
    if (gi) src = `import * as M from '${mocks}'; export default M.${gi[1]};`;
    else if (spec.endsWith('/ui/main.js')) src = `import {Main as M} from '${mocks}'; export const layoutManager = M.layoutManager, overview = M.overview;`;
    else src = 'export default class {}; export const Extension = class {};';
    return { format: 'module', source: src, shortCircuit: true };
}
