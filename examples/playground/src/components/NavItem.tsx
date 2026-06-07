import type { JSX, MouseEvent } from 'react';

interface NavItemProps {
  label: string;
  href: string;
  testid: string;
}

// Renders a single <a> (data-comp="NavItem"); siblings share tag + component, so the inspector
// reports a sibling index/total. preventDefault keeps clicks from navigating in the playground.
export function NavItem({ label, href, testid }: NavItemProps): JSX.Element {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => e.preventDefault();
  return (
    <a className="nav-item" href={href} data-testid={testid} onClick={onClick}>
      {label}
    </a>
  );
}
