/** Layer actions for the Quire controller: adding, selecting, showing, renaming, reordering, and deleting ink layers. Mixed into QuireApp. */

import { confirmDialog } from '../dialogs.js';
import {
  MAX_LAYERS,
  hasInkOn,
  newLayerId,
} from '../drawing.js';

export const layerActionMethods = {
  // ---------- layers ----------

  /** Drawing on a hidden layer shows it first, so the stroke is not lost. */
  ensureActiveVisible() {
    const layer = this.layers.find((item) => item.id === this.activeLayer);
    if (layer && !layer.visible) {
      layer.visible = true;
      this.changeLayers();
    }
  },

  /** Layer structure changed: refresh the panel, replay the ops, and save. */
  changeLayers() {
    this.renderLayers();
    this.rebuildInk();
    this.scheduleSave();
  },

  selectLayer(id) {
    if (id === this.activeLayer) return;
    this.commitTextDraft(); // the open text box belongs to the layer it was started on // a re-render here would detach a row that is being double-clicked
    this.activeLayer = id;
    this.renderLayers();
  },

  toggleLayer(id) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) return;
    this.commitTextDraft();
    layer.visible = !layer.visible;
    this.changeLayers();
  },

  renameLayer(id, name) {
    const layer = this.layers.find((item) => item.id === id);
    if (!layer) return;
    layer.name = name.slice(0, 40);
    this.renderLayers();
    this.scheduleSave();
  },

  moveLayer(id, dir) {
    const index = this.layers.findIndex((item) => item.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= this.layers.length) return;
    this.commitTextDraft();
    [this.layers[index], this.layers[target]] = [this.layers[target], this.layers[index]];
    this.changeLayers();
  },

  addLayer() {
    if (!this.entry) return;
    if (this.layers.length >= MAX_LAYERS) {
      this.showStatus(`A page holds up to ${MAX_LAYERS} layers`, true);
      return;
    }
    this.commitTextDraft();
    let n = this.layers.length + 1;
    while (this.layers.some((layer) => layer.name === `Layer ${n}`)) n += 1;
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayer);
    const layer = { id: newLayerId(), name: `Layer ${n}`, visible: true };
    this.layers.splice(index + 1, 0, layer);
    this.activeLayer = layer.id;
    this.changeLayers();
  },

  async deleteLayer(id) {
    const index = this.layers.findIndex((item) => item.id === id);
    if (!this.entry || index < 0) return;
    if (this.layers.length < 2) {
      this.showStatus('A page needs at least one layer', true);
      return;
    }
    const layer = this.layers[index];
    if (hasInkOn(this.drawing.ops, id)) {
      const ok = await confirmDialog({
        title: 'Delete this layer?',
        message: `“${layer.name}” and everything drawn on it will be removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
    }
    this.commitTextDraft();
    this.drawing.purgeLayer(id);
    this.layers.splice(index, 1);
    if (this.activeLayer === id) this.activeLayer = this.layers[Math.max(0, index - 1)].id;
    this.selection = new Set();
    this.changeLayers();
  },
};
