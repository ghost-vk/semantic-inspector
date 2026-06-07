import { isAbsolute, relative, sep } from 'node:path';
import type { types as BabelTypes, ConfigAPI, NodePath, PluginObj } from '@babel/core';

export interface StampLocOptions {
  /** Path attribute name. Default 'data-loc'. */
  attrLoc?: string;
  /** Component attribute name. Default 'data-comp'. */
  attrComp?: string;
  /** Base for the relative path written into data-loc. Default process.cwd(). */
  rootDir?: string;
}

export function isHostElement(name: BabelTypes.JSXOpeningElement['name']): boolean {
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name);
}

function hasAttr(el: BabelTypes.JSXOpeningElement, attrName: string): boolean {
  return el.attributes.some(
    (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === attrName
  );
}

// Nearest PascalCase function-component ancestor:
//   function Foo() {}  |  const Foo = () => {}  |  const Foo = function () {}
export function nearestComponentName(path: NodePath): string | null {
  let p: NodePath | null = path;
  while (p) {
    const node = p.node;
    if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) {
      return node.id.name;
    }
    if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const parent = p.parentPath?.node;
      if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' && /^[A-Z]/.test(parent.id.name)) {
        return parent.id.name;
      }
    }
    p = p.parentPath;
  }
  return null;
}

/**
 * Babel plugin: stamps data-loc="<path>:<line>:<col>" and data-comp="<Component>" onto JSX
 * host elements (div, section, ...). The runtime inspector reads these DOM attributes (not
 * React internals), so it stays robust across React versions. Component tags (PascalCase) are
 * skipped — they don't produce their own DOM node.
 */
export function stampLocBabel(api: ConfigAPI & { types: typeof BabelTypes }, opts: StampLocOptions = {}): PluginObj {
  api.assertVersion(7);
  const t = api.types;
  const attrLoc = opts.attrLoc ?? 'data-loc';
  const attrComp = opts.attrComp ?? 'data-comp';
  const rootDir = opts.rootDir ?? process.cwd();

  const attr = (name: string, value: string) => t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));

  // Relative POSIX path from rootDir. Files outside rootDir degrade to their basename so an
  // absolute filesystem path can never leak into the stamped DOM.
  const toRel = (file: string): string => {
    const rel = relative(rootDir, file);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      return file.split(/[\\/]/).pop() ?? 'unknown';
    }
    return rel.split(sep).join('/');
  };

  return {
    name: 'stamp-loc',
    visitor: {
      JSXOpeningElement(path, state) {
        const node = path.node;
        if (!isHostElement(node.name)) return;

        const filename = state.file.opts.filename;
        const loc = node.loc;
        if (!filename || !loc) return;

        if (!hasAttr(node, attrLoc)) {
          node.attributes.push(attr(attrLoc, `${toRel(filename)}:${loc.start.line}:${loc.start.column + 1}`));
        }
        if (!hasAttr(node, attrComp)) {
          const comp = nearestComponentName(path);
          if (comp) node.attributes.push(attr(attrComp, comp));
        }
      }
    }
  };
}
