import { withBrowser } from '../tests/support/browser.js';
import { verifyWorkspace } from '../tests/features/collaboration/browser-checks.js';
import { verifyDocx } from '../tests/features/documents/browser-checks.js';
await withBrowser(async browser => { if (!process.argv.includes('--docx')) await verifyWorkspace(browser); await verifyDocx(browser); });
