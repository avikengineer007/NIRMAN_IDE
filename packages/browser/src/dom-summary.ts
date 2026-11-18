import type { Page } from 'playwright-core';
import type { DomSummary, InteractiveElementInfo } from './types.js';

/**
 * Extracts a compact, structured representation of the page DOM
 * designed specifically to minimize token usage for small-context models.
 */
export async function extractDomSummary(page: Page, maxTextChars = 2000): Promise<DomSummary> {
  const summary = await page.evaluate((maxChars: number) => {
    const title = document.title || '';
    const url = window.location.href || '';

    // 1. Headings
    const headingEls = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const headings = headingEls.slice(0, 10).map((el: Element) => {
      const level = parseInt(el.tagName.substring(1), 10) || 1;
      return {
        level,
        text: (el.textContent || '').trim().replace(/\s+/g, ' '),
      };
    });

    // 2. Interactive Elements (buttons, inputs, links, forms)
    const interactiveQuery =
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="checkbox"]';
    const els = Array.from(document.querySelectorAll(interactiveQuery));

    const interactiveElements: InteractiveElementInfo[] = [];

    for (const el of els.slice(0, 30)) {
      const htmlEl = el as HTMLElement;
      // Skip hidden or invisible elements
      if (
        htmlEl.offsetParent === null &&
        htmlEl.tagName !== 'INPUT' &&
        htmlEl.tagName !== 'BUTTON'
      ) {
        continue;
      }

      const tag = htmlEl.tagName.toLowerCase();
      const id = htmlEl.id || undefined;
      const name = (htmlEl as HTMLInputElement).name || undefined;
      const type = (htmlEl as HTMLInputElement).type || undefined;
      const role = htmlEl.getAttribute('role') || undefined;
      const placeholder = (htmlEl as HTMLInputElement).placeholder || undefined;
      let text = (htmlEl.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length > 50) {
        text = text.substring(0, 50) + '...';
      }

      // Generate best selector
      let selector = tag;
      if (id) {
        selector = `#${id}`;
      } else if (name) {
        selector = `${tag}[name="${name}"]`;
      } else if (placeholder) {
        selector = `${tag}[placeholder="${placeholder}"]`;
      } else if (text && tag === 'button') {
        selector = `button:has-text("${text.replace(/"/g, '\\"')}")`;
      } else if (type && tag === 'input') {
        selector = `input[type="${type}"]`;
      }

      interactiveElements.push({
        tag,
        id,
        name,
        type,
        role,
        text: text || undefined,
        placeholder,
        selector,
      });
    }

    // 3. Compact visible text content
    // Clone body and remove noisy tags
    const clone = document.body.cloneNode(true) as HTMLElement;
    const noisyEls = clone.querySelectorAll('script, style, svg, noscript, iframe');
    noisyEls.forEach((n: Element) => n.remove());

    let rawText = (clone.textContent || '').trim().replace(/\s+/g, ' ');
    if (rawText.length > maxChars) {
      rawText = rawText.substring(0, maxChars) + '... [TRUNCATED]';
    }

    return {
      title,
      url,
      headings,
      interactiveElements,
      textContent: rawText,
    };
  }, maxTextChars);

  return summary;
}

/**
 * Formats a DomSummary into a concise text block suitable for prompt injection
 */
export function formatDomSummaryForPrompt(summary: DomSummary): string {
  const lines: string[] = [];
  lines.push(`Page Title: "${summary.title}" (${summary.url})`);

  if (summary.headings.length > 0) {
    lines.push(`Headings:`);
    for (const h of summary.headings) {
      lines.push(`  ${'#'.repeat(h.level)} ${h.text}`);
    }
  }

  if (summary.interactiveElements.length > 0) {
    lines.push(`Interactive Elements:`);
    for (const el of summary.interactiveElements) {
      const details = [
        el.id ? `id="${el.id}"` : '',
        el.name ? `name="${el.name}"` : '',
        el.type ? `type="${el.type}"` : '',
        el.placeholder ? `placeholder="${el.placeholder}"` : '',
        el.text ? `text="${el.text}"` : '',
      ]
        .filter(Boolean)
        .join(' ');

      lines.push(`  - <${el.tag} ${details}> -> selector: \`${el.selector}\``);
    }
  }

  if (summary.textContent) {
    lines.push(`Visible Content:\n${summary.textContent}`);
  }

  return lines.join('\n');
}
