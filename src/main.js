import { QuireApp } from './app.js';
import { startSplash } from './splash.js';
import { mark } from './perf.js';

mark('quire:boot');
const splash = startSplash();
const app = new QuireApp();
app
  .start()
  .catch((error) => {
    console.error(error);
    app.showStatus(`Quire could not start: ${error.message}`, true);
  })
  .finally(() => splash.done());
