"use client";

import type { ReactNode } from "react";

type ReportMarkdownProps = {
  markdown: string;
};

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const tokenPattern =
    /(\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = tokenPattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-${match.index}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);

      if (linkMatch) {
        nodes.push(
          <a
            key={`${keyPrefix}-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-700 underline decoration-teal-300 underline-offset-4 transition-colors hover:text-teal-600"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-${match.index}`}
          className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.92em] text-zinc-700"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
    match = tokenPattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function ReportMarkdown({ markdown }: ReportMarkdownProps) {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      blocks.push(
        <hr key={`hr-${index}`} className="my-8 border-zinc-200" />,
      );
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const commonClasses = "font-semibold tracking-tight text-zinc-950";

      if (level === 1) {
        blocks.push(
          <h1 key={`h1-${index}`} className={`text-4xl ${commonClasses}`}>
            {renderInlineMarkdown(headingText, `h1-${index}`)}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2
            key={`h2-${index}`}
            className={`mt-10 border-t border-zinc-200 pt-7 text-2xl ${commonClasses}`}
          >
            {renderInlineMarkdown(headingText, `h2-${index}`)}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={`h3-${index}`} className={`mt-7 text-xl ${commonClasses}`}>
            {renderInlineMarkdown(headingText, `h3-${index}`)}
          </h3>,
        );
      }

      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${index}`} className="space-y-3 pl-6 text-base leading-8 text-zinc-700">
          {items.map((item, itemIndex) => (
            <li key={`ul-${index}-${itemIndex}`} className="list-disc">
              {renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${index}`} className="space-y-3 pl-6 text-base leading-8 text-zinc-700">
          {items.map((item, itemIndex) => (
            <li key={`ol-${index}-${itemIndex}`} className="list-decimal">
              {renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];

    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !/^---+$/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`} className="text-base leading-8 text-zinc-700">
        {renderInlineMarkdown(paragraphLines.join(" "), `p-${index}`)}
      </p>,
    );
  }

  return <article className="space-y-5">{blocks}</article>;
}
