import { QuireApp } from './app.js';

const app = new QuireApp();
app.start().catch((error) => {
  console.error(error);
  app.showStatus(`Quire could not start: ${error.message}`, true);
});
