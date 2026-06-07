import type { JSX } from 'react';
import { NavItem } from './NavItem';

const ITEMS = [
  { label: 'Сюжеты', href: '/stories', testid: 'nav-stories' },
  { label: 'Рубрики', href: '/rubrics', testid: 'nav-rubrics' },
  { label: 'Подписки', href: '/subscriptions', testid: 'nav-subscriptions' },
  { label: 'Закладки', href: '/bookmarks', testid: 'nav-bookmarks' }
];

export function Sidebar(): JSX.Element {
  return (
    <nav className="sidebar" aria-label="Главное меню">
      <div className="nav-list">
        {ITEMS.map((it) => (
          <NavItem key={it.testid} label={it.label} href={it.href} testid={it.testid} />
        ))}
      </div>
    </nav>
  );
}
