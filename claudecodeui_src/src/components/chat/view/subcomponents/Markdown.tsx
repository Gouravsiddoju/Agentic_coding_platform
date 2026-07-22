import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { copyTextToClipboard } from '../../../../utils/clipboard';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  onFileClick?: (path: string) => void;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="group relative my-2">
      {language && language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(raw).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })
        }
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-600 bg-gray-700/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-gray-700 focus:opacity-100 active:opacity-100 group-hover:opacity-100"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const HoverableBlock = ({ as: Component = 'div', children, className, ...props }: any) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const blockRef = useRef<HTMLElement>(null);

  const handleSubmit = () => {
    if (commentText.trim() && blockRef.current) {
      // Create a clone to strip the comment UI text
      const clone = blockRef.current.cloneNode(true) as HTMLElement;
      const popup = clone.querySelector('.markdown-comment-popup');
      if (popup) popup.remove();
      
      const blockContent = clone.textContent || '';
      const formattedText = `> ${blockContent.trim()}\n\n${commentText.trim()}`;
      const event = new CustomEvent('optcode:append-input', { detail: { text: formattedText } });
      window.dispatchEvent(event);
    }
    setIsCommenting(false);
    setCommentText('');
    setIsHovered(false);
  };

  return (
    <Component
      ref={blockRef}
      className={`group relative ${className || ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (!isCommenting) setIsHovered(false);
      }}
      {...props}
    >
      {children}
      {(isHovered || isCommenting) && (
        <div className="markdown-comment-popup absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 shadow-sm bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 flex items-center p-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {!isCommenting ? (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsCommenting(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              title="Add Comment"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1 w-48">
              <input
                ref={inputRef}
                type="text"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmit();
                  } else if (e.key === 'Escape') {
                    setIsCommenting(false);
                    setCommentText('');
                    setIsHovered(false);
                  }
                }}
                className="w-full text-xs bg-transparent border-none outline-none focus:ring-0 p-1 text-gray-900 dark:text-gray-100"
                placeholder="Comment & Enter..."
              />
            </div>
          )}
        </div>
      )}
    </Component>
  );
};

const getMarkdownComponents = (onFileClick?: (path: string) => void) => ({
  code: CodeBlock,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (href?.startsWith('file:///')) {
      const path = href.replace('file:///', '');
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (onFileClick) onFileClick(path);
          }}
          className="text-blue-600 hover:underline dark:text-blue-400 font-mono"
          title={path}
        >
          {children}
        </button>
      );
    }
    return (
      <a href={href} className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => <HoverableBlock as="p" className="mb-2 last:mb-0 pr-6">{children}</HoverableBlock>,
  li: ({ children, ...props }: any) => <HoverableBlock as="li" className="pr-6" {...props}>{children}</HoverableBlock>,
  h1: ({ children, ...props }: any) => <HoverableBlock as="h1" className="pr-6" {...props}>{children}</HoverableBlock>,
  h2: ({ children, ...props }: any) => <HoverableBlock as="h2" className="pr-6" {...props}>{children}</HoverableBlock>,
  h3: ({ children, ...props }: any) => <HoverableBlock as="h3" className="pr-6" {...props}>{children}</HoverableBlock>,
  h4: ({ children, ...props }: any) => <HoverableBlock as="h4" className="pr-6" {...props}>{children}</HoverableBlock>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
  ),
});

export function Markdown({ children, className, onFileClick }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  const components = useMemo(() => getMarkdownComponents(onFileClick), [onFileClick]);

  return (
    <div className={`markdown-body dark:markdown-body-dark relative ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components as any}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
