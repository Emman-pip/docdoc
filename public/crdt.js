import { validateImage } from './images.js';

// Replicated growable array: immutable character inserts and grow-only tombstones.
// Lamport clocks order siblings; missing parents remain buffered in the state.
export class Document {
  constructor(actor, state) {
    this.actor = actor;
    this.clock = 0;
    this.nodes = new Map();
    this.deleted = new Set();
    this.images = new Map();
    this.title = { value: 'Untitled document', clock: 0, actor: '' };
    if (state) this.merge(state);
  }
  merge(state) {
    if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.deleted)) throw new Error('Invalid document');
    for (const node of state.nodes) {
      if (!node || typeof node.id !== 'string' || node.id.length > 100 || typeof node.after !== 'string' || node.after.length > 100 || typeof node.value !== 'string' || node.value.length !== 1 || !Number.isSafeInteger(node.clock) || node.clock < 1 || typeof node.actor !== 'string' || node.actor.length > 64 || node.id !== `${node.actor}:${node.clock}` || node.id === node.after) throw new Error('Invalid character');
      const existing = this.nodes.get(node.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(node)) throw new Error('Conflicting character');
      this.nodes.set(node.id, { id: node.id, after: node.after, value: node.value, clock: node.clock, actor: node.actor });
      this.clock = Math.max(this.clock, node.clock);
    }
    for (const id of state.deleted) {
      if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid deletion');
      this.deleted.add(id);
    }
    if (state.images !== undefined && !Array.isArray(state.images)) throw new Error('Invalid photos');
    for (const image of state.images || []) this.addImage(image);
    const title = state.title;
    if (title) {
      if (typeof title.value !== 'string' || title.value.length > 120 || !Number.isSafeInteger(title.clock) || title.clock < 0 || typeof title.actor !== 'string' || title.actor.length > 64) throw new Error('Invalid title');
      this.clock = Math.max(this.clock, title.clock);
      if (title.clock > this.title.clock || (title.clock === this.title.clock && title.actor > this.title.actor)) this.title = { ...title };
    }
  }
  visible() {
    const children = new Map();
    for (const node of this.nodes.values()) {
      if (!children.has(node.after)) children.set(node.after, []);
      children.get(node.after).push(node);
    }
    for (const list of children.values()) list.sort((a, b) => b.clock - a.clock || (a.actor < b.actor ? 1 : a.actor > b.actor ? -1 : 0));
    const result = [], seen = new Set(), stack = [...(children.get('') || [])].reverse();
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (!this.deleted.has(node.id)) result.push(node);
      const descendants = children.get(node.id) || [];
      for (let i = descendants.length - 1; i >= 0; i--) stack.push(descendants[i]);
    }
    return result;
  }
  text() { return this.visible().map(node => node.value).join(''); }
  edit(value) {
    const visible = this.visible(), previous = visible.map(node => node.value).join('');
    let start = 0, end = 0;
    while (start < previous.length && start < value.length && previous[start] === value[start]) start++;
    while (end < previous.length - start && end < value.length - start && previous[previous.length - 1 - end] === value[value.length - 1 - end]) end++;
    for (const node of visible.slice(start, previous.length - end)) this.deleted.add(node.id);
    let after = start ? visible[start - 1].id : '';
    for (let i = start; i < value.length - end; i++) {
      const clock = ++this.clock, id = `${this.actor}:${clock}`;
      this.nodes.set(id, { id, after, value: value[i], clock, actor: this.actor });
      after = id;
    }
  }
  addImage(image) {
    validateImage(image);
    const existing = this.images.get(image.id);
    if (existing && existing.data !== image.data) throw new Error('Conflicting photo');
    this.images.set(image.id, { id: image.id, data: image.data });
  }
  rename(value) { this.title = { value: value.slice(0, 120), clock: ++this.clock, actor: this.actor }; }
  snapshot() { return { nodes: [...this.nodes.values()], deleted: [...this.deleted], title: this.title, images: [...this.images.values()] }; }
}
