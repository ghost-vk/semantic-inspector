import type { JSX, MouseEvent } from 'react';

interface ContentCardProps {
  title: string;
  body: string;
  link: { label: string; href: string };
}

export function ContentCard({ title, body, link }: ContentCardProps): JSX.Element {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => e.preventDefault();
  return (
    <article className="card">
      <h2 className="card-title">{title}</h2>
      <p className="card-body">{body}</p>
      <a className="card-link" href={link.href} onClick={onClick}>
        {link.label}
      </a>
    </article>
  );
}
