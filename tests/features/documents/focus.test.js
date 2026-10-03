import test from 'node:test';
import assert from 'node:assert/strict';
import { attachFocus, startsInPreview } from '../../../public/features/preferences/focus.js';
test('joined and legacy collaborator records reopen in preview; new local documents open for editing', () => {
  assert.equal(startsInPreview({ local: true }), false);
  assert.equal(startsInPreview({ local: true, room: { token: 'token', ownerToken: 'owner' } }), false);
  assert.equal(startsInPreview({ joined: true, room: {} }), true);
  assert.equal(startsInPreview({ room: { token: 'legacy' } }), true);
  assert.equal(startsInPreview({ policy: { enabled: false } }), false);
});
test('focus mode toggles and Escape respects dialogs, exits, and returns keyboard focus', () => {
  const previous = globalThis.document; globalThis.document = {};
  try {
    let handler, active = false, dialog = false, focused = false;
    const button = { setAttribute() {}, focus() { focused = true; } };
    const control = attachFocus({ button, body: { classList: { toggle(_, value) { active = value; } } }, hasDialog: () => dialog, listen: callback => handler = callback });
    button.onclick(); assert.equal(active, true); assert.equal(button.textContent, 'Exit focus mode');
    dialog = true; handler({ key: 'Escape' }); assert.equal(active, true);
    dialog = false; let prevented = false; handler({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(active, false); assert.equal(prevented, true); assert.equal(focused, true);
    button.onclick(); control.exit(); assert.equal(active, false);
  } finally { globalThis.document = previous; }
});
