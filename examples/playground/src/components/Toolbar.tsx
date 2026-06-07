import type { JSX } from 'react';

export function Toolbar(): JSX.Element {
  return (
    <div className="toolbar" role="toolbar" aria-label="Действия">
      <button type="button" className="btn btn-primary" data-testid="action-publish">
        Опубликовать
      </button>
      <button type="button" className="btn" data-testid="action-save">
        Save draft
      </button>
      <button type="button" className="btn btn-ghost" data-testid="action-cancel">
        Отмена
      </button>
    </div>
  );
}
