import { QuireApp } from './app.js';
import { startSplash } from './splash.js';
import { mark } from './perf.js';
import { markDesktopShell } from './desktop.js';

mark('quire:boot');
markDesktopShell();
const splash = startSplash();
const app = new QuireApp();
app
  .start()
  .catch((error) => {
    console.error(error);
    app.showStatus(`Quire could not start: ${error.message}`, true);
  })
  .finally(() => splash.done());
