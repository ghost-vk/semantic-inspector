import type { types as BabelTypes, NodePath } from '@babel/core';
import { parseSync, traverse } from '@babel/core';
import { isHostElement, nearestComponentName } from './stampLocBabel';
import type { StaticElement } from './types';

const ATTR_WHITELIST = ['id', 'data-testid', 'name', 'href', 'type'];
const TEXT_CAP = 160;
const PATH_CAP = 4;

function parserPlugins(file: string): ('jsx' | 'typescript')[] {
  if (file.endsWith('.tsx')) return ['jsx', 'typescript'];
  if (file.endsWith('.ts')) return ['typescript'];
  return ['jsx']; // .jsx, .js
}

function literalAttrs(open: BabelTypes.JSXOpeningElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of open.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
    if (!ATTR_WHITELIST.includes(a.name.name)) continue;
    const v = a.value;
    if (v?.type === 'StringLiteral') out[a.name.name] = v.value;
    else if (v?.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral') {
      out[a.name.name] = v.expression.value;
    }
  }
  return out;
}

function literalText(node: BabelTypes.JSXElement): string | undefined {
  const parts: string[] = [];
  const walk = (children: BabelTypes.JSXElement['children']): void => {
    for (const c of children) {
      if (c.type === 'JSXText') parts.push(c.value);
      else if (c.type === 'JSXElement') walk(c.children);
      else if (c.type === 'JSXFragment') walk(c.children);
      // JSXExpressionContainer / JSXSpreadChild → dynamic, skipped
    }
  };
  walk(node.children);
  const raw = parts.join('').replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  const cp = [...raw];
  return cp.length > TEXT_CAP ? `${cp.slice(0, TEXT_CAP).join('')}…` : raw;
}

function componentPath(path: NodePath<BabelTypes.JSXElement>): string[] {
  const chain: string[] = [];
  let p: NodePath | null = path;
  while (p) {
    if (p.isJSXElement() && isHostElement(p.node.openingElement.name)) {
      const c = nearestComponentName(p);
      if (c && chain[chain.length - 1] !== c) chain.push(c);
    }
    p = p.parentPath;
  }
  return chain.slice(0, PATH_CAP).reverse();
}

/**
 * Parse `source` and return every JSX host element as a StaticElement (AST analog of
 * extractSemantics). `file` is a relative POSIX path; it is used verbatim in `loc` and to pick
 * parser plugins. Throws if the source cannot be parsed.
 */
export function staticAnchors(file: string, source: string): StaticElement[] {
  const ast = parseSync(source, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: { plugins: parserPlugins(file), errorRecovery: false }
  });
  if (!ast) throw new Error(`failed to parse ${file}`);

  const out: StaticElement[] = [];
  traverse(ast, {
    JSXElement(path) {
      const open = path.node.openingElement;
      if (!isHostElement(open.name)) return;
      const loc = open.loc;
      if (!loc) return;
      const el: StaticElement = {
        file,
        loc: `${file}:${loc.start.line}:${loc.start.column + 1}`,
        comp: nearestComponentName(path),
        path: componentPath(path),
        attrs: literalAttrs(open)
      };
      const text = literalText(path.node);
      if (text) el.text = text;
      out.push(el);
    }
  });
  return out;
}
