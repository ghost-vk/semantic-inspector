import type { JSX } from 'react';
import { NavItem } from './NavItem';

const ITEMS = [
  { label: 'Stories', href: '/stories', testid: 'nav-stories' },
  { label: 'Topics', href: '/rubrics', testid: 'nav-rubrics' },
  { label: 'Subscriptions', href: '/subscriptions', testid: 'nav-subscriptions' },
  { label: 'Bookmarks', href: '/bookmarks', testid: 'nav-bookmarks' }
];

export function Sidebar(): JSX.Element {
  return (
    <nav className="sidebar" aria-label="Main menu">
      <div className="nav-list">
        {ITEMS.map((it) => (
          <NavItem key={it.testid} label={it.label} href={it.href} testid={it.testid} />
        ))}
      </div>
    </nav>
  );
}
