import type { JSX } from 'react';
import { ContentCard } from './components/ContentCard';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';

function Legend(): JSX.Element {
  return (
    <ul className="legend">
      <li>
        <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> — inspect: hover to highlight, click copies the identifier,{' '}
        <kbd>Shift</kbd>+click copies a screenshot.
      </li>
      <li>
        <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> — annotate: click an element to give it a name (try naming a
        Russian item "пилюля").
      </li>
      <li>
        <kbd>Esc</kbd> — exit either mode.
      </li>
    </ul>
  );
}

export function App(): JSX.Element {
  return (
    <div className="app">
      <header className="app-header">
        <h1>semantic-inspector · playground</h1>
        <Legend />
      </header>
      <div className="app-body">
        <Sidebar />
        <main className="content">
          <Toolbar />
          <div className="cards">
            <ContentCard
              title="Лента"
              body="Свежие материалы по вашим подпискам. Click me in inspect mode to copy the path."
              link={{ label: 'Открыть ленту', href: '/feed' }}
            />
            <ContentCard
              title="Settings"
              body="Account preferences and notifications. Смешанный текст на двух языках."
              link={{ label: 'Manage account', href: '/settings/account' }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
