import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('renders fenced code blocks with and without language labels and preserves whitespace', () => {
  const html = renderMarkdown('Before\n```javascript\nconst answer = 42;\n  keep spacing\n```\n```\nplain\ttext\n```\nAfter');
  assert.match(html, /<span class="code-language">javascript<\/span>/);
  assert.match(html, /<pre><code>const answer = 42;\n  keep spacing<\/code><\/pre>/);
  assert.match(html, /<pre><code>plain\ttext<\/code><\/pre>/);
  assert.equal((html.match(/class="code-language"/g) || []).length, 1);
  assert.match(html, /<p>Before<\/p>/);
  assert.match(html, /<p>After<\/p>/);
});

test('escapes code contents and language labels and treats an unclosed fence as end of document', () => {
  const html = renderMarkdown('```<img src=x onerror=alert(1)>\n<script>alert("x")</script>\n  <b>literal</b>');
  assert.match(html, /<span class="code-language">&lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;\n  &lt;b&gt;literal&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<b>|<img/);
});

test('renders Markdown tables with inline formatting, column alignment, escaped pipes, and escaped HTML', () => {
  const html = renderMarkdown('| Name | Score | Notes |\n| :--- | ---: | :---: |\n| **Ada** | 10 | first \\| second |\n| <img src=x> | 7 | ok |');
  assert.match(html, /<table><thead><tr><th scope="col" class="align-left">Name<\/th><th scope="col" class="align-right">Score<\/th><th scope="col" class="align-center">Notes<\/th>/);
  assert.match(html, /<td class="align-left"><strong>Ada<\/strong><\/td><td class="align-right">10<\/td><td class="align-center">first \| second<\/td>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
});
