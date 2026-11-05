import { Fragment, type ReactNode } from "react";

/** Minimal, safe Markdown subset for note preview: no HTML, no scripts. */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const content = inline(heading[2]);
      if (level === 1) blocks.push(<h1 key={`h-${blocks.length}`}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${blocks.length}`}>{content}</h2>);
      else blocks.push(<h3 key={`h-${blocks.length}`}>{content}</h3>);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <>{blocks}</>;
}

function inline(text: string): ReactNode {
  const tokens: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
  while (remaining) {
    const match = remaining.match(pattern);
    if (!match || match.index === undefined) {
      tokens.push(<Fragment key={key++}>{remaining}</Fragment>);
      break;
    }
    if (match.index > 0) tokens.push(<Fragment key={key++}>{remaining.slice(0, match.index)}</Fragment>);
    const token = match[0];
    if (token.startsWith("**")) tokens.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) tokens.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link && /^(https?:|#|pdfreader:)/i.test(link[2])) {
        tokens.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else tokens.push(<Fragment key={key++}>{token}</Fragment>);
    }
    remaining = remaining.slice(match.index + token.length);
  }
  return tokens;
}

export function noteExcerpt(body: string, maxLength = 120): string {
  const plain = body
    .replace(/[#*`>\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}
