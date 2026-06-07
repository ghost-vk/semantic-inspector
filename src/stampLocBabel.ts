import type { NodePath, PluginObj, types as BabelTypes } from '@babel/core';

export interface StampLocOptions {
  /** Имя атрибута пути. Default 'data-loc'. */
  attrLoc?: string;
  /** Имя атрибута компонента. Default 'data-comp'. */
  attrComp?: string;
  /** База для относительного пути в data-loc. Default process.cwd(). */
  rootDir?: string;
}

function isHostElement(name: BabelTypes.JSXOpeningElement['name']): boolean {
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name);
}

function hasAttr(el: BabelTypes.JSXOpeningElement, attrName: string): boolean {
  return el.attributes.some(
    (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === attrName
  );
}

// Ближайшая функция-компонент с PascalCase-именем вверх по дереву:
//   function Foo() {}  |  const Foo = () => {}  |  const Foo = function () {}
function nearestComponentName(path: NodePath): string | null {
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
 * Babel-плагин: вешает data-loc="<path>:<line>" и data-comp="<Component>" на
 * JSX host-элементы (div, section, ...). Рантайм-инспектор читает эти DOM-атрибуты
 * (не React-internals), поэтому устойчив к версии React. Компонентные теги
 * (PascalCase) пропускаем — они не дают собственного DOM-узла.
 */
export default function stampLocBabel(babel: { types: typeof BabelTypes }, opts: StampLocOptions = {}): PluginObj {
  const t = babel.types;
  const attrLoc = opts.attrLoc ?? 'data-loc';
  const attrComp = opts.attrComp ?? 'data-comp';
  const rootDir = opts.rootDir ?? process.cwd();

  const attr = (name: string, value: string) => t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));

  // path.relative без node:path, чтобы плагин не тянул узловые модули в чужих средах.
  const toRel = (file: string): string => {
    let root = rootDir;
    while (root.endsWith('/')) root = root.slice(0, -1);
    const rel = file.startsWith(root + '/') ? file.slice(root.length + 1) : file;
    return rel.split('\\').join('/');
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
          node.attributes.push(attr(attrLoc, `${toRel(filename)}:${loc.start.line}`));
        }
        if (!hasAttr(node, attrComp)) {
          const comp = nearestComponentName(path);
          if (comp) node.attributes.push(attr(attrComp, comp));
        }
      }
    }
  };
}
